import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type Guild,
  type GuildMember,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { IMAGE_VARIABLES, type Button, type Design, type Select } from "./format.js";
import { fillVariables } from "./variables.js";

export const SEPARATOR_TEXT = "────────";
const STYLES: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
export type ContainerItem = TextDisplayBuilder | SectionBuilder | MediaGalleryBuilder | SeparatorBuilder | Row;

export function buttonStyle(name?: string): ButtonStyle {
  return STYLES[name ?? "secondary"] ?? ButtonStyle.Secondary;
}

/** Adds an item with the matching method; ContainerBuilder only has typed add methods. */
export function addItem(container: ContainerBuilder, item: ContainerItem): void {
  if (item instanceof TextDisplayBuilder) container.addTextDisplayComponents(item);
  else if (item instanceof SectionBuilder) container.addSectionComponents(item);
  else if (item instanceof MediaGalleryBuilder) container.addMediaGalleryComponents(item);
  else if (item instanceof SeparatorBuilder) container.addSeparatorComponents(item);
  else container.addActionRowComponents(item);
}

function withEmoji<T extends ButtonBuilder | StringSelectMenuOptionBuilder>(builder: T, emoji?: string): T {
  if (emoji) builder.setEmoji(emoji);
  return builder;
}

/**
 * Default rendering of a select block.
 * Select menu: customId as given, values are the option values.
 * Buttons: customId + ":" + value. Resolve the choice with chosenOptions.
 */
export function selectRows(menu: Select, customId: string): Row[] {
  if (menu.mode === "select") {
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setMinValues(menu.exclusive ? 1 : 0)
      .setMaxValues(menu.exclusive ? 1 : menu.options.length)
      .addOptions(
        menu.options.map((option) => {
          const item = new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.value);
          if (option.description) item.setDescription(option.description);
          return withEmoji(item, option.emoji);
        }),
      );
    if (menu.placeholder) select.setPlaceholder(menu.placeholder);
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)];
  }
  const buttons = menu.options.map((option) =>
    withEmoji(new ButtonBuilder().setCustomId(`${customId}:${option.value}`).setLabel(option.label).setStyle(ButtonStyle.Secondary), option.emoji),
  );
  const rows: Row[] = [];
  for (let start = 0; start < buttons.length; start += 5) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons.slice(start, start + 5)));
  }
  return rows;
}

export interface RenderOptions {
  member?: GuildMember | null;
  guild?: Guild | null;
  /** Items added first, e.g. a large image of your own. */
  header?: ContainerItem[];
  /** Top-right image if the design has no image block. */
  thumbnail?: string | null;
  /** Button next to the first text if there is no thumbnail. */
  accessory?: ButtonBuilder | null;
  /** id -> builder for your buttons; unknown ids are skipped. */
  buttons?: Record<string, (button: Button) => ButtonBuilder>;
  /** Text for dynamic blocks; missing slots are skipped. */
  slots?: Record<string, string>;
  /** Renders select blocks; they are skipped without it. */
  selects?: (menu: Select, guild: Guild | null) => Row[] | null | undefined;
  /** Extra variables, e.g. {"{level}": "3"}. */
  variables?: Record<string, string>;
}

/** Fills a ContainerBuilder from a validated design, including the accent color. */
export function render(design: Design, options: RenderOptions = {}, container = new ContainerBuilder()): ContainerBuilder {
  const { member = null, guild = null, buttons = {}, slots = {}, selects, variables } = options;
  let accessory = options.accessory ?? null;
  if (design.color !== undefined) container.setAccentColor(design.color);
  for (const item of options.header ?? []) addItem(container, item);
  const fill = (value: string) => fillVariables(value, member, guild, variables);
  const resolved = (url: string) => ((IMAGE_VARIABLES as readonly string[]).includes(url) ? fill(url) : url);

  let image: string | null = options.thumbnail ?? null;
  if (!image) for (const block of design.blocks) if ("image" in block) { image = block.image; break; }
  image = image ? resolved(image) || null : null;

  const texts: string[] = [];
  const galleries: string[] = [];
  const links: ButtonBuilder[] = [];

  const flushLinks = () => {
    for (let start = 0; start < links.length; start += 5) {
      addItem(container, new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(links.slice(start, start + 5)));
    }
    links.length = 0;
  };
  const flushText = () => {
    if (!texts.length) return;
    const display = new TextDisplayBuilder().setContent(texts.join("\n"));
    texts.length = 0;
    if (image) {
      addItem(container, new SectionBuilder().addTextDisplayComponents(display).setThumbnailAccessory(new ThumbnailBuilder().setURL(image)));
      image = null;
    } else if (accessory) {
      addItem(container, new SectionBuilder().addTextDisplayComponents(display).setButtonAccessory(accessory));
      accessory = null;
    } else addItem(container, display);
  };
  const flushGallery = () => {
    if (!galleries.length) return;
    addItem(container, new MediaGalleryBuilder().addItems(galleries.slice(0, 10).map((url) => new MediaGalleryItemBuilder().setURL(url))));
    galleries.length = 0;
  };

  for (const block of design.blocks) {
    if ("link" in block) {
      flushText();
      flushGallery();
      links.push(withEmoji(new ButtonBuilder().setLabel(block.link.label).setURL(block.link.url).setStyle(ButtonStyle.Link), block.link.emoji));
      continue;
    }
    if ("button" in block) {
      const action = buttons[block.button.id];
      if (action) {
        flushText();
        flushGallery();
        links.push(action(block.button));
      }
      continue;
    }
    if ("select" in block) {
      flushText();
      flushGallery();
      flushLinks();
      for (const row of selects?.(block.select, member?.guild ?? guild) ?? []) addItem(container, row);
      continue;
    }
    if ("slot" in block) {
      flushLinks();
      flushGallery();
      const value = slots[block.slot];
      if (value) texts.push(value);
      continue;
    }
    if (!("image" in block)) flushLinks();
    if ("gallery" in block) {
      flushText();
      const url = resolved(block.gallery);
      if (url) galleries.push(url);
      continue;
    }
    if ("text" in block) {
      flushGallery();
      // Discord only renders headings with a space after the #.
      texts.push(fill(block.text).replace(/^(#{1,3})(?=[^#\s])/gm, "$1 "));
    } else if ("separator" in block) {
      flushGallery();
      texts.push(SEPARATOR_TEXT);
    }
  }
  flushText();
  flushGallery();
  flushLinks();
  if (image) {
    addItem(container, new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("​")).setThumbnailAccessory(new ThumbnailBuilder().setURL(image)));
  }
  return container;
}

/** The design's content as a TextDisplayBuilder placed above the container, or null. */
export function outsideText(design: Design, options: Pick<RenderOptions, "member" | "guild" | "variables"> = {}): TextDisplayBuilder | null {
  if (!design.content) return null;
  return new TextDisplayBuilder().setContent(fillVariables(design.content, options.member, options.guild, options.variables));
}

/** Top-level components of a message: the outside text (if any) and the filled container. */
export function renderMessage(design: Design, options: RenderOptions = {}): (TextDisplayBuilder | ContainerBuilder)[] {
  const text = outsideText(design, options);
  const container = render(design, options);
  return text ? [text, container] : [container];
}
