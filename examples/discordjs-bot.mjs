// Minimal role picker: /design configures a panel, /send imports and publishes it.
// Set DISCORD_TOKEN in the environment, then run node discordjs-bot.mjs.
import {
  Client, Events, GatewayIntentBits, InteractionContextType, MessageFlags,
  PermissionFlagsBits, SlashCommandBuilder,
} from "discord.js";
import {
  chosenOptions, EditorClient, EditorError, findSelect, guildContext, MediaError,
  MediaStore, renderMessage, selectRows, selectsFor, TemplateError,
} from "discomposer";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const editor = new EditorClient({ media: new MediaStore("data/media") });
const saved = new Map(); // message id -> design; persist this in a real bot.

function canOfferRole(member, role) {
  return role && role.id !== member.guild.id && role.editable
    && (member.id === member.guild.ownerId || member.roles.highest.comparePositionTo(role) > 0);
}

client.once(Events.ClientReady, async () => {
  await client.application.commands.set([
    new SlashCommandBuilder().setName("design").setDescription("Opens the role picker editor.")
      .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName("send").setDescription("Publishes a role picker from the editor.")
      .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addStringOption((option) => option.setName("code").setDescription("Code from the editor").setRequired(true)),
  ]);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && ["design", "send"].includes(interaction.commandName)) {
      // Default command permissions can be overridden in Discord, so check at execution too.
      if (!interaction.inCachedGuild() || !interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({ content: "Manage Roles in this server is required.", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.commandName === "design") {
        const context = guildContext(interaction.guild);
        context.roles = context.roles.filter(({ id }) => canOfferRole(interaction.member, interaction.guild.roles.cache.get(id)));
        const link = await editor.open({
          title: "Role picker",
          context: { ...context, selects: [{ purpose: "role_picker", label: "Role picker", roles: "single" }] },
          design: { blocks: [{ text: "## Roles\nPick what you are interested in." }] },
        });
        await interaction.editReply({ content: link });
        return;
      }
      const design = await editor.fetch(interaction.options.getString("code", true));
      // A shared code may contain any document, including roles the editor never offered.
      for (const menu of selectsFor(design, "role_picker")) {
        for (const option of menu.options) {
          if (option.roles?.length !== 1 || option.value !== option.roles[0]
            || !canOfferRole(interaction.member, interaction.guild.roles.cache.get(option.roles[0]))) {
            throw new TemplateError("Every option must use one role that you and the bot can manage.");
          }
        }
      }
      const components = renderMessage(design, {
        guild: interaction.guild,
        selects: (menu) => menu.purpose === "role_picker" ? selectRows(menu, "demo:" + menu.id) : [],
      });
      const message = await interaction.channel.send({
        components, files: editor.media.filesFor(design), flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      saved.set(message.id, design);
      await interaction.editReply({ content: "Sent." });
      return;
    }
    if (!interaction.inCachedGuild()
      || !(interaction.isStringSelectMenu() || interaction.isButton())
      || !interaction.customId.startsWith("demo:")) return;
    const design = saved.get(interaction.message.id);
    const [, selectId, value] = interaction.customId.split(":");
    if (!design || findSelect(design, selectId)?.purpose !== "role_picker") return;
    const values = interaction.isStringSelectMenu() ? interaction.values : [value];
    const roles = chosenOptions(design, selectId, values)
      .flatMap((option) => option.roles ?? [])
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter((role) => role && role.id !== interaction.guild.id && role.editable);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (roles.length) await interaction.member.roles.add(roles, "Role picker");
    await interaction.editReply({ content: roles.length ? "Done: " + roles.map((role) => role.name).join(", ") : "No roles selected." });
  } catch (error) {
    const content = error instanceof EditorError || error instanceof TemplateError || error instanceof MediaError
      ? error.message : "The action could not be completed.";
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
});

client.login(process.env.DISCORD_TOKEN);
