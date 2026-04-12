import { TagsInput } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "./TagInputField.css";
import {
  normalizeTagLookup,
  normalizeTagName,
  sortTagsByName,
  uniqueTagNames,
  uniqueTagsByName
} from "../lib/tags";
import type { AppLanguage, Tag } from "../types";

interface TagInputFieldProps {
  tags: Tag[];
  selectedTagIds: string[];
  language: AppLanguage;
  onChangeTagIds: (tagIds: string[]) => Promise<void> | void;
  onCreateTag: (name: string) => Promise<Tag>;
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export default function TagInputField({
  tags,
  selectedTagIds,
  language,
  onChangeTagIds,
  onCreateTag
}: TagInputFieldProps) {
  const { t } = useTranslation();
  const commitVersionRef = useRef(0);
  const [searchValue, setSearchValue] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const safeTags = useMemo(() => uniqueTagsByName(tags), [tags]);
  const tagsById = useMemo(() => new Map(safeTags.map((tag) => [tag.id, tag])), [safeTags]);
  const tagsByLookup = useMemo(
    () => new Map(safeTags.map((tag) => [normalizeTagLookup(tag.name), tag])),
    [safeTags]
  );
  const selectedNames = useMemo(
    () =>
      uniqueTagNames(
        selectedTagIds.map((tagId) => tagsById.get(tagId)?.name ?? "")
      ),
    [selectedTagIds, tagsById]
  );
  const [draftNames, setDraftNames] = useState(selectedNames);
  const suggestions = useMemo(
    () => sortTagsByName(safeTags, language).map((tag) => tag.name),
    [safeTags, language]
  );
  const normalizedSearch = normalizeTagName(searchValue);
  const hasExistingSearchMatch = normalizedSearch
    ? tagsByLookup.has(normalizeTagLookup(normalizedSearch))
    : false;

  useEffect(() => {
    if (!areStringArraysEqual(draftNames, selectedNames)) {
      setDraftNames(selectedNames);
    }
  }, [draftNames, selectedNames]);

  const helperText = isCommitting
    ? t("saveState.saving")
    : normalizedSearch
      ? hasExistingSearchMatch
        ? t("tags.pickSuggestion")
        : t("tags.createHint", { name: normalizedSearch })
      : t("tags.inputHint");

  const commitNames = async (nextNames: string[]) => {
    const cleanedNames = uniqueTagNames(nextNames);
    setDraftNames(cleanedNames);

    const commitVersion = ++commitVersionRef.current;
    setIsCommitting(true);

    try {
      const resolvedIds: string[] = [];
      const seenIds = new Set<string>();
      const workingLookup = new Map(tagsByLookup);

      for (const name of cleanedNames) {
        const normalized = normalizeTagName(name);

        if (!normalized) {
          continue;
        }

        const lookup = normalizeTagLookup(normalized);
        let resolvedTag = workingLookup.get(lookup);

        if (!resolvedTag) {
          resolvedTag = await onCreateTag(normalized);
          workingLookup.set(normalizeTagLookup(resolvedTag.name), resolvedTag);
        }

        if (!seenIds.has(resolvedTag.id)) {
          seenIds.add(resolvedTag.id);
          resolvedIds.push(resolvedTag.id);
        }
      }

      if (commitVersion !== commitVersionRef.current) {
        return;
      }

      await onChangeTagIds(resolvedIds);
    } finally {
      if (commitVersion === commitVersionRef.current) {
        setIsCommitting(false);
        setSearchValue("");
      }
    }
  };

  return (
    <div className="tag-input-shell">
      <TagsInput
        className="tag-input-control"
        classNames={{
          input: "tag-input-input",
          pillsList: "tag-input-pills",
          pill: "tag-input-pill",
          inputField: "tag-input-field",
          dropdown: "tag-input-dropdown",
          option: "tag-input-option"
        }}
        value={draftNames}
        data={suggestions}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onChange={(nextValues) => {
          void commitNames(nextValues);
        }}
        placeholder={draftNames.length === 0 ? t("tags.fieldPlaceholder") : ""}
        splitChars={[",", ";"]}
        acceptValueOnBlur
        openOnFocus
        limit={12}
        comboboxProps={{
          withinPortal: false,
          position: "bottom-start",
          offset: 6
        }}
        isDuplicate={(value, currentValues) =>
          currentValues.some((currentValue) => {
            return normalizeTagLookup(currentValue) === normalizeTagLookup(value);
          })
        }
        renderOption={({ option }) => (
          <div className="tag-input-option-row">
            <span className="tag-input-option-text">{option.value}</span>
            <span className="tag-input-option-meta">{t("tags.existing")}</span>
          </div>
        )}
        aria-label={t("note.tags")}
      />

      <p className={`tag-input-hint ${isCommitting ? "is-busy" : ""}`}>{helperText}</p>
    </div>
  );
}
