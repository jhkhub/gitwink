import { describe, expect, it } from "vitest";

import { parseDiff } from "./diff";

describe("parseDiff", () => {
  it("keeps deleted lines whose content starts with '-- ' (SQL comment) and doesn't shift line numbers", () => {
    // Deleting "-- init schema" arrives as "--- init schema" — it must parse
    // as a delete, not be skipped as a +++/--- preamble header.
    const unified = [
      "diff --git a/schema.sql b/schema.sql",
      "index 111..222 100644",
      "--- a/schema.sql",
      "+++ b/schema.sql",
      "@@ -1,3 +1,2 @@",
      "--- init schema",
      " CREATE TABLE t (id INT);",
      " INSERT INTO t VALUES (1);",
    ].join("\n");
    const { hunks } = parseDiff(unified);
    expect(hunks).toHaveLength(1);
    const rows = hunks[0].rows;
    expect(rows).toHaveLength(3);
    expect(rows[0].left).toMatchObject({
      lineNum: 1,
      text: "-- init schema",
      type: "delete",
    });
    // Line numbers after the delete must NOT be shifted.
    expect(rows[1].left).toMatchObject({ lineNum: 2, type: "context" });
    expect(rows[1].right).toMatchObject({ lineNum: 1, type: "context" });
    expect(rows[2].left).toMatchObject({ lineNum: 3, type: "context" });
  });

  it("keeps added lines whose content starts with '++ '", () => {
    const unified = [
      "@@ -1,1 +1,2 @@",
      " ctx",
      "+++ increment twice",
    ].join("\n");
    const { hunks } = parseDiff(unified);
    const rows = hunks[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[1].right).toMatchObject({
      lineNum: 2,
      text: "++ increment twice",
      type: "add",
    });
  });

  it("still ignores the real ---/+++ preamble before the first hunk", () => {
    const unified = [
      "diff --git a/f b/f",
      "index 111..222 100644",
      "--- a/f",
      "+++ b/f",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const { hunks } = parseDiff(unified);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].rows).toHaveLength(1);
    expect(hunks[0].rows[0].left.text).toBe("old");
    expect(hunks[0].rows[0].right.text).toBe("new");
  });

  it("a second file's 'diff ' section closes the current hunk (multi-file safety)", () => {
    const unified = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "diff --git a/b b/b",
      "--- a/b",
      "+++ b/b",
      "@@ -5,1 +5,1 @@",
      "-p",
      "+q",
    ].join("\n");
    const { hunks } = parseDiff(unified);
    expect(hunks).toHaveLength(2);
    // The second file's ---/+++ preamble must not leak into either hunk.
    expect(hunks[0].rows).toHaveLength(1);
    expect(hunks[1].rows).toHaveLength(1);
    expect(hunks[1].rows[0].left).toMatchObject({ lineNum: 5, text: "p" });
  });

  it("keeps the no-newline marker skip", () => {
    const unified = [
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
    ].join("\n");
    const { hunks } = parseDiff(unified);
    expect(hunks[0].rows).toHaveLength(1);
    expect(hunks[0].rows[0].left.text).toBe("old");
    expect(hunks[0].rows[0].right.text).toBe("new");
  });
});
