import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import "./NoteStaticPreview.css";
import { resolveEditorFontFamily } from "../lib/blocknoteSchema";
import { normalizeNoteContent } from "../lib/notes";
import type { NoteContent, StoredBlock } from "../types";

const DARK_TEXT_COLORS: Record<string, string> = {
  gray: "#bebdb8",
  brown: "#8e6552",
  red: "#ec4040",
  orange: "#e3790d",
  yellow: "#dfab01",
  green: "#6b8b87",
  blue: "#0e87bc",
  purple: "#8552d7",
  pink: "#da208f"
};

const DARK_BACKGROUND_COLORS: Record<string, string> = {
  gray: "#35363b",
  brown: "#3f2d26",
  red: "#5a262a",
  orange: "#57361d",
  yellow: "#564317",
  green: "#213b3b",
  blue: "#18384a",
  purple: "#372553",
  pink: "#4f1f43"
};

type TableContent = {
  type?: string;
  headerRows?: unknown;
  headerCols?: unknown;
  rows?: Array<{
    cells?: Array<{
      type?: string;
      props?: Record<string, unknown>;
      content?: unknown;
    }>;
  }>;
};

interface NoteStaticPreviewProps {
  content: NoteContent;
  emptyLabel: string;
  resolveFileUrl?: (url: string) => Promise<string>;
  compact?: boolean;
  interactive?: boolean;
  className?: string;
}

function getColorValue(
  value: unknown,
  palette: Record<string, string>
) {
  if (typeof value !== "string" || value.length === 0 || value === "default") {
    return undefined;
  }

  return palette[value] ?? value;
}

function getBlockStyle(props: Record<string, unknown> | undefined) {
  const style: CSSProperties = {};
  const textColor = getColorValue(props?.textColor, DARK_TEXT_COLORS);
  const backgroundColor = getColorValue(props?.backgroundColor, DARK_BACKGROUND_COLORS);
  const textAlignment = props?.textAlignment;

  if (textColor) {
    style.color = textColor;
  }

  if (backgroundColor) {
    style.backgroundColor = backgroundColor;
  }

  if (
    textAlignment === "left" ||
    textAlignment === "center" ||
    textAlignment === "right" ||
    textAlignment === "justify"
  ) {
    style.textAlign = textAlignment;
  }

  return style;
}

function getInlineStyle(styles: unknown) {
  if (!styles || typeof styles !== "object") {
    return undefined;
  }

  const record = styles as Record<string, unknown>;
  const style: CSSProperties = {};

  const fontFamily = resolveEditorFontFamily(
    typeof record.font === "string" ? record.font : null
  );

  if (fontFamily) {
    style.fontFamily = fontFamily;
  }

  if (record.bold) {
    style.fontWeight = 700;
  }

  if (record.italic) {
    style.fontStyle = "italic";
  }

  const decorations: string[] = [];

  if (record.underline) {
    decorations.push("underline");
  }

  if (record.strike) {
    decorations.push("line-through");
  }

  if (decorations.length > 0) {
    style.textDecoration = decorations.join(" ");
  }

  if (record.code) {
    style.fontFamily = "\"IBM Plex Mono\", ui-monospace, monospace";
    style.padding = "0.06rem 0.34rem";
    style.borderRadius = "0.42rem";
    style.background = "rgba(255, 255, 255, 0.08)";
  }

  const textColor = getColorValue(record.textColor, DARK_TEXT_COLORS);
  const backgroundColor = getColorValue(record.backgroundColor, DARK_BACKGROUND_COLORS);

  if (textColor) {
    style.color = textColor;
  }

  if (backgroundColor) {
    style.backgroundColor = backgroundColor;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function getResolvedUrl(
  url: string | null,
  resolvedUrls: Record<string, string>
) {
  if (!url) {
    return null;
  }

  if (url.startsWith("asset://")) {
    return resolvedUrls[url] ?? null;
  }

  return resolvedUrls[url] ?? url;
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractText(entry)).join(" ").replace(/\s+/g, " ").trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record.text === "string") {
    parts.push(record.text);
  }

  if (typeof record.href === "string") {
    parts.push(extractText(record.content));
  }

  Object.entries(record).forEach(([key, nestedValue]) => {
    if (key !== "text" && key !== "href") {
      const nestedText = extractText(nestedValue);
      if (nestedText) {
        parts.push(nestedText);
      }
    }
  });

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function collectUrls(blocks: StoredBlock[]) {
  const found = new Set<string>();

  const visit = (entries: StoredBlock[]) => {
    entries.forEach((block) => {
      const url = typeof block.props?.url === "string" ? block.props.url : null;

      if (url) {
        found.add(url);
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        visit(block.children);
      }
    });
  };

  visit(blocks);
  return [...found];
}

function renderInlineContent(content: unknown, keyPrefix: string): ReactNode {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }

  return content.map((item, index) => renderInlineNode(item, `${keyPrefix}-${index}`));
}

function renderInlineNode(item: unknown, key: string): ReactNode {
  if (typeof item === "string") {
    return <Fragment key={key}>{item}</Fragment>;
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;

  if (record.type === "link" && typeof record.href === "string") {
    return (
      <a
        key={key}
        className="note-static-link"
        href={record.href}
        target="_blank"
        rel="noreferrer"
      >
        {renderInlineContent(record.content, `${key}-content`)}
      </a>
    );
  }

  const contentNode =
    typeof record.text === "string"
      ? record.text
      : renderInlineContent(record.content, `${key}-content`);

  const style = getInlineStyle(record.styles);

  return (
    <span key={key} style={style}>
      {contentNode}
    </span>
  );
}

type RenderContext = {
  compact: boolean;
  interactive: boolean;
  emptyLabel: string;
  resolvedUrls: Record<string, string>;
};

function hasInlineContent(content: unknown) {
  return extractText(content).trim().length > 0;
}

function hasRenderableBlockStream(blocks: StoredBlock[]) {
  return blocks.some((block) => hasRenderableBlock(block));
}

function hasRenderableBlock(block: StoredBlock): boolean {
  const blockType = block.type ?? "paragraph";
  const hasRenderableChildren =
    Array.isArray(block.children) && block.children.length > 0
      ? hasRenderableBlockStream(block.children)
      : false;

  if (blockType === "divider") {
    return true;
  }

  if (blockType === "table") {
    const tableContent = block.content as TableContent | undefined;

    return (
      !!tableContent &&
      typeof tableContent === "object" &&
      Array.isArray(tableContent.rows) &&
      tableContent.rows.length > 0
    );
  }

  if (blockType === "image" || blockType === "video" || blockType === "audio" || blockType === "file") {
    const props = (block.props ?? {}) as Record<string, unknown>;
    const rawUrl = typeof props.url === "string" ? props.url.trim() : "";
    const caption = typeof props.caption === "string" ? props.caption.trim() : "";
    const name = typeof props.name === "string" ? props.name.trim() : "";

    return Boolean(rawUrl || caption || name || hasRenderableChildren);
  }

  return hasInlineContent(block.content) || hasRenderableChildren;
}

function renderMediaBlock(
  block: StoredBlock,
  kind: "image" | "video" | "audio" | "file",
  context: RenderContext,
  key: string
) {
  const props = (block.props ?? {}) as Record<string, unknown>;
  const rawUrl = typeof props.url === "string" ? props.url : null;
  const url = getResolvedUrl(rawUrl, context.resolvedUrls);
  const caption = typeof props.caption === "string" ? props.caption.trim() : "";
  const name = typeof props.name === "string" && props.name.trim().length > 0 ? props.name.trim() : null;
  const previewWidth = typeof props.previewWidth === "number" ? props.previewWidth : undefined;
  const showPreview = props.showPreview !== false;
  const canShowInteractiveMedia = context.interactive && !context.compact;
  const mediaStyle =
    previewWidth && !context.compact
      ? ({ "--note-static-preview-width": `${previewWidth}px` } as CSSProperties)
      : undefined;

  if (kind === "image" && showPreview && url) {
    return (
      <figure key={key} className="note-static-figure note-static-figure-image" style={mediaStyle}>
        <img
          className="note-static-image"
          src={url}
          alt={caption || name || "Image"}
          loading="lazy"
        />
        {caption ? <figcaption className="note-static-caption">{caption}</figcaption> : null}
      </figure>
    );
  }

  if (kind === "video" && showPreview && url && canShowInteractiveMedia) {
    return (
      <figure key={key} className="note-static-figure note-static-figure-video" style={mediaStyle}>
        <video className="note-static-video" src={url} controls preload="metadata" />
        {caption ? <figcaption className="note-static-caption">{caption}</figcaption> : null}
      </figure>
    );
  }

  if (kind === "audio" && showPreview && url && canShowInteractiveMedia) {
    return (
      <figure key={key} className="note-static-figure note-static-figure-audio">
        <audio className="note-static-audio" src={url} controls preload="metadata" />
        {caption ? <figcaption className="note-static-caption">{caption}</figcaption> : null}
      </figure>
    );
  }

  const label = name || caption || url;

  if (!label) {
    return null;
  }

  return (
    <figure key={key} className="note-static-attachment">
      {url ? (
        <a
          className="note-static-attachment-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <span className="note-static-attachment-kind">{kind}</span>
          <span className="note-static-attachment-name">{label}</span>
        </a>
      ) : (
        <div className="note-static-attachment-link">
          <span className="note-static-attachment-kind">{kind}</span>
          <span className="note-static-attachment-name">{label}</span>
        </div>
      )}
      {caption && caption !== label ? <figcaption className="note-static-caption">{caption}</figcaption> : null}
    </figure>
  );
}

function renderTableBlock(block: StoredBlock, context: RenderContext, key: string) {
  const tableContent = block.content as TableContent | undefined;

  if (
    !tableContent ||
    typeof tableContent !== "object" ||
    !Array.isArray(tableContent.rows) ||
    tableContent.rows.length === 0
  ) {
    return null;
  }

  const headerRows = typeof tableContent.headerRows === "number" ? tableContent.headerRows : 0;
  const headerCols = typeof tableContent.headerCols === "number" ? tableContent.headerCols : 0;

  return (
    <div key={key} className="note-static-table-wrap">
      <table className="note-static-table">
        <tbody>
          {tableContent.rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`}>
              {(row.cells ?? []).map((cell, cellIndex) => {
                const CellTag = rowIndex < headerRows || cellIndex < headerCols ? "th" : "td";
                const cellProps = (cell.props ?? {}) as Record<string, unknown>;
                const colSpan = typeof cellProps.colspan === "number" ? cellProps.colspan : 1;
                const rowSpan = typeof cellProps.rowspan === "number" ? cellProps.rowspan : 1;

                return (
                  <CellTag
                    key={`${key}-cell-${rowIndex}-${cellIndex}`}
                    className="note-static-table-cell"
                    style={getBlockStyle(cellProps)}
                    colSpan={colSpan}
                    rowSpan={rowSpan}
                  >
                    {renderInlineContent(cell.content, `${key}-cell-inline-${rowIndex}-${cellIndex}`)}
                  </CellTag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderListGroup(
  blocks: StoredBlock[],
  type: string,
  context: RenderContext,
  key: string
) {
  const visibleBlocks = blocks.filter((block) => hasRenderableBlock(block));

  if (visibleBlocks.length === 0) {
    return null;
  }

  const isNumbered = type === "numberedListItem";
  const isBullet = type === "bulletListItem";
  const isCheck = type === "checkListItem";
  const ListTag = (isNumbered ? "ol" : "ul") as "ol" | "ul";

  return (
    <ListTag
      key={key}
      className={[
        "note-static-list",
        isNumbered ? "note-static-list-numbered" : "",
        isBullet ? "note-static-list-bullet" : "",
        isCheck ? "note-static-list-check" : "",
        type === "toggleListItem" ? "note-static-list-toggle" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {visibleBlocks.map((block, index) => {
        const checked = Boolean(block.props?.checked);
        const hasText = hasInlineContent(block.content);
        const marker =
          isCheck ? (
            <span className="note-static-checkmark">
              <input type="checkbox" checked={checked} readOnly disabled />
            </span>
          ) : type === "toggleListItem" ? (
            <span className="note-static-toggle-marker" aria-hidden="true">
              {">"}
            </span>
          ) : null;

        return (
          <li key={`${key}-item-${index}`} className="note-static-list-item">
            {marker}
            <div className="note-static-list-body">
              {hasText ? (
                <div className="note-static-list-text" style={getBlockStyle(block.props)}>
                  {renderInlineContent(block.content, `${key}-item-inline-${index}`)}
                </div>
              ) : null}
              {Array.isArray(block.children) && block.children.length > 0 ? (
                <div className="note-static-children">
                  {renderBlockStream(block.children, context, `${key}-item-children-${index}`)}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ListTag>
  );
}

function renderBlock(block: StoredBlock, context: RenderContext, key: string) {
  const blockType = block.type ?? "paragraph";
  const hasText = hasInlineContent(block.content);
  const children =
    Array.isArray(block.children) && block.children.length > 0 ? (
      <div className="note-static-children">
        {renderBlockStream(block.children, context, `${key}-children`)}
      </div>
    ) : null;

  if (blockType === "image" || blockType === "video" || blockType === "audio" || blockType === "file") {
    const mediaBlock = renderMediaBlock(block, blockType, context, `${key}-${blockType}`);

    if (!mediaBlock && !children) {
      return null;
    }

    return (
      <Fragment key={key}>
        {mediaBlock}
        {children}
      </Fragment>
    );
  }

  if (blockType === "table") {
    return (
      <Fragment key={key}>
        {renderTableBlock(block, context, `${key}-table`)}
        {children}
      </Fragment>
    );
  }

  if (blockType === "divider") {
    return (
      <Fragment key={key}>
        <hr className="note-static-divider" />
        {children}
      </Fragment>
    );
  }

  if (blockType === "codeBlock") {
    const code = extractText(block.content);

    if (!code && !children) {
      return null;
    }

    return (
      <Fragment key={key}>
        {code ? (
          <pre className="note-static-code">
            <code>{code}</code>
          </pre>
        ) : null}
        {children}
      </Fragment>
    );
  }

  if (blockType === "quote") {
    if (!hasText && !children) {
      return null;
    }

    return (
      <Fragment key={key}>
        {hasText ? (
          <blockquote className="note-static-quote" style={getBlockStyle(block.props)}>
            {renderInlineContent(block.content, `${key}-quote`)}
          </blockquote>
        ) : null}
        {children}
      </Fragment>
    );
  }

  if (blockType === "heading") {
    const level = typeof block.props?.level === "number" ? block.props.level : 2;
    const HeadingTag = (level <= 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : "h4") as
      | "h1"
      | "h2"
      | "h3"
      | "h4";

    if (!hasText && !children) {
      return null;
    }

    return (
      <Fragment key={key}>
        {hasText ? (
          <HeadingTag className="note-static-heading" style={getBlockStyle(block.props)}>
            {renderInlineContent(block.content, `${key}-heading`)}
          </HeadingTag>
        ) : null}
        {children}
      </Fragment>
    );
  }

  if (!hasText && !children) {
    return null;
  }

  return (
    <Fragment key={key}>
      {hasText ? (
        <p className="note-static-paragraph" style={getBlockStyle(block.props)}>
          {renderInlineContent(block.content, `${key}-paragraph`)}
        </p>
      ) : null}
      {children}
    </Fragment>
  );
}

function renderBlockStream(blocks: StoredBlock[], context: RenderContext, keyPrefix: string) {
  const rendered: ReactNode[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const blockType = block.type ?? "paragraph";

    if (
      blockType === "bulletListItem" ||
      blockType === "numberedListItem" ||
      blockType === "checkListItem" ||
      blockType === "toggleListItem"
    ) {
      const group: StoredBlock[] = [block];

      while (index + 1 < blocks.length && (blocks[index + 1].type ?? "paragraph") === blockType) {
        group.push(blocks[index + 1]);
        index += 1;
      }

      rendered.push(renderListGroup(group, blockType, context, `${keyPrefix}-list-${index}`));
      continue;
    }

    rendered.push(renderBlock(block, context, `${keyPrefix}-block-${index}`));
  }

  return rendered;
}

export default function NoteStaticPreview({
  content,
  emptyLabel,
  resolveFileUrl,
  compact = false,
  interactive = false,
  className
}: NoteStaticPreviewProps) {
  const normalizedContent = useMemo(() => normalizeNoteContent(content), [content]);
  const trackedUrls = useMemo(() => collectUrls(normalizedContent), [normalizedContent]);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const resolveAllUrls = async () => {
      if (trackedUrls.length === 0) {
        setResolvedUrls({});
        return;
      }

      const entries = await Promise.all(
        trackedUrls.map(async (url) => {
          if (!resolveFileUrl) {
            return [url, url] as const;
          }

          try {
            const resolved = await resolveFileUrl(url);
            return [url, resolved] as const;
          } catch {
            return [url, url] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setResolvedUrls(Object.fromEntries(entries));
    };

    void resolveAllUrls();

    return () => {
      cancelled = true;
    };
  }, [resolveFileUrl, trackedUrls]);

  if (normalizedContent.length === 0) {
    return <p className="note-static-empty">{emptyLabel}</p>;
  }

  const context: RenderContext = {
    compact,
    interactive,
    emptyLabel,
    resolvedUrls
  };
  const hasVisibleContent = hasRenderableBlockStream(normalizedContent);

  if (!hasVisibleContent) {
    return normalizedContent.length === 0 ? (
      <p className="note-static-empty">{emptyLabel}</p>
    ) : (
      <div
        className={[
          "note-static-preview",
          compact ? "is-compact" : "",
          interactive ? "is-interactive" : "",
          className ?? ""
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
  }

  return (
    <div
      className={[
        "note-static-preview",
        compact ? "is-compact" : "",
        interactive ? "is-interactive" : "",
        className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {renderBlockStream(normalizedContent, context, "note-static")}
    </div>
  );
}
