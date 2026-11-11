// Minimal discord.js bot: /design opens the editor, /send fetches a code and sends the message.
// Run: set DISCORD_TOKEN as an environment variable, then `node discordjs-bot.mjs`.
import { Client, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from "discord.js";
import { chosenOptions, EditorClient, EditorError, guildContext, MediaStore, render, selectRows, TemplateError } from "discomposer";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const editor = new EditorClient({ media: new MediaStore("data/media") });
const saved = new Map(); // message id -> stored design. A real bot keeps this in a database.

client.once(Events.ClientReady, async () => {
  await client.application.commands.set([
    new SlashCommandBuilder().setName("design").setDescription("Opens the editor with this server's roles."),
    new SlashCommandBuilder()
      .setName("send")
      .setDescription("Sends a template from the editor.")
      .addStringOption((option) => option.setName("code").setDescription("Code from the editor").setRequired(true)),
  ]);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "design") {
    const link = await editor.open({
      title: "Role picker",
      context: { ...guildContext(interaction.guild), selects: [{ purpose: "role_picker", label: "Role picker", roles: "single" }] },
      design: { blocks: [{ text: "## Roles\nPick what you are interested in." }] },
    });
    await interaction.reply({ content: link, flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.isChatInputCommand() && interaction.commandName === "send") {
    let design;
    try {
      design = await editor.fetch(interaction.options.getString("code", true));
    } catch (error) {
      if (!(error instanceof EditorError || error instanceof TemplateError)) throw error;
      await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      return;
    }
    const container = render(design, { guild: interaction.guild, selects: (menu) => selectRows(menu, `demo:${menu.id}`) });
    await interaction.reply({ content: "Sent.", flags: MessageFlags.Ephemeral });
    const message = await interaction.channel.send({ components: [container], files: editor.media.filesFor(design), flags: MessageFlags.IsComponentsV2 });
    saved.set(message.id, design);
    return;
  }
  if ((interaction.isStringSelectMenu() || interaction.isButton()) && interaction.customId.startsWith("demo:")) {
    const design = saved.get(interaction.message.id);
    if (!design) return;
    const [, selectId, value] = interaction.customId.split(":");
    const values = interaction.isStringSelectMenu() ? interaction.values : [value];
    // Roles only come from the stored template, never from the interaction.
    const roles = chosenOptions(design, selectId, values)
      .flatMap((option) => option.roles ?? [])
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter((role) => role && !role.managed && role.id !== interaction.guild.id);
    await interaction.member.roles.add(roles, "Role picker");
    await interaction.reply({ content: `Done: ${roles.map((role) => role.name).join(", ")}`, flags: MessageFlags.Ephemeral });
  }
});

client.login(process.env.DISCORD_TOKEN);
