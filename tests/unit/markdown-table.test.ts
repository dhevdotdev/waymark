import { describe, expect, it } from "vitest";
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  setAlignment,
  setCell,
} from "../../src/vault/markdown-table";

const TABLE = ["| Name  |   Age | Note |", "|:------|------:|:---:|", "| Ada   |    36 | **x** |", "| Grace | 85 | a \\| b |"];

describe("parseTable", () => {
  it("reads cells, alignment and escaped pipes", () => {
    const { rows, align } = parseTable(TABLE);
    expect(rows[0]).toEqual(["Name", "Age", "Note"]);
    expect(rows[2]).toEqual(["Grace", "85", "a | b"]);
    expect(align).toEqual(["left", "right", "center"]);
  });

  it("copes with no outer pipes and rows of the wrong length", () => {
    const { rows } = parseTable(["a | b", "--- | ---", "1", "1 | 2 | 3"]);
    expect(rows).toEqual([
      ["a", "b"],
      ["1", ""],
      ["1", "2"],
    ]);
  });
});

describe("setCell", () => {
  it("changes only that cell's text and keeps the spacing around it", () => {
    expect(setCell(TABLE, 1, 0, "Lovelace")[2]).toBe("| Lovelace   |    36 | **x** |");
    expect(setCell(TABLE, 1, 0, "Lovelace").filter((l, i) => l !== TABLE[i])).toHaveLength(1);
  });

  it("edits the header without touching the delimiter", () => {
    const next = setCell(TABLE, 0, 1, "Years");
    expect(next[0]).toBe("| Name  |   Years | Note |");
    expect(next[1]).toBe(TABLE[1]);
  });

  it("escapes pipes and flattens line breaks", () => {
    expect(setCell(TABLE, 2, 0, "a|b\nc")[3]).toBe("| a\\|b c | 85 | a \\| b |");
  });

  it("does not double-escape a pipe that came from the file", () => {
    const text = parseTable(TABLE).rows[2][2];
    expect(setCell(TABLE, 2, 2, text)).toEqual(TABLE);
  });

  it("keeps the next cell apart when the text ends in a backslash", () => {
    const next = setCell(["|b|c|", "|---|---|"], 0, 0, "a\\");
    expect(parseTable(next).rows[0]).toEqual(["a\\", "c"]);
  });

  it("reads a pipe after a double backslash the way the renderer does", () => {
    expect(parseTable(["| a\\\\| b |", "|---|"]).rows[0]).toEqual(["a\\| b"]);
  });

  it("adds a missing cell without rewriting the rest of the row", () => {
    expect(setCell(["a | b | c", "--|--|--", "1  |  2"], 1, 2, "3")[2]).toBe("1  |  2 | 3 |");
  });

  it("fills an empty cell", () => {
    expect(setCell(["| a |  |", "|---|---|"], 0, 1, "b")[0]).toBe("| a | b |");
    expect(setCell(["|a||", "|---|---|"], 0, 1, "b")[0]).toBe("|a| b |");
  });

  it("gives a short row the cell it was missing", () => {
    expect(setCell(["| a | b |", "|---|---|", "| 1 |"], 1, 1, "2")[2]).toBe("| 1 | 2 |");
  });
});

describe("rows and columns", () => {
  it("adds a row in place and right after the delimiter for the header", () => {
    expect(insertRow(TABLE, 1)[3]).toBe("|  |  |  |");
    expect(insertRow(TABLE, 0)[2]).toBe("|  |  |  |");
    expect(insertRow(TABLE, 2)).toHaveLength(5);
  });

  it("deletes a body row and never the header", () => {
    expect(deleteRow(TABLE, 1)).toEqual([TABLE[0], TABLE[1], TABLE[3]]);
    expect(deleteRow(TABLE, 0)).toEqual(TABLE);
  });

  it("adds a column with a delimiter", () => {
    const next = insertColumn(["| a | b |", "|---|---|", "| 1 | 2 |"], 0);
    expect(next).toEqual(["| a |  | b |", "|---| --- |---|", "| 1 |  | 2 |"]);
    expect(parseTable(next).rows[0]).toEqual(["a", "", "b"]);
  });

  it("deletes a column, first or last, and never the only one", () => {
    const table = ["| a | b |", "|---|---|", "| 1 | 2 |"];
    expect(deleteColumn(table, 0)).toEqual(["| b |", "|---|", "| 2 |"]);
    expect(deleteColumn(table, 1)).toEqual(["| a |", "|---|", "| 1 |"]);
    expect(deleteColumn(["| a |", "|---|"], 0)).toEqual(["| a |", "|---|"]);
  });

  it("survives a row too short for the column being deleted", () => {
    expect(deleteColumn(["| a | b |", "|---|---|", "| 1 |"], 1)[2]).toBe("| 1 |");
  });
});

describe("insertColumn at the start", () => {
  it("adds an empty first column to every line", () => {
    const after = insertColumn(["| a | b |", "|---|---|", "| 1 | 2 |"], -1);
    expect(parseTable(after).rows).toEqual([
      ["", "a", "b"],
      ["", "1", "2"],
    ]);
  });

  it("works on a table with no outer pipes", () => {
    expect(parseTable(insertColumn(["a | b", "--- | ---", "1 | 2"], -1)).rows[1]).toEqual(["", "1", "2"]);
  });
});

describe("setAlignment", () => {
  const table = ["| a | b |", "|---|---|", "| 1 | 2 |"];

  it.each([
    ["left", "left"],
    ["center", "center"],
    ["right", "right"],
  ] as const)("sets %s alignment on one column only", (align, expected) => {
    expect(parseTable(setAlignment(table, 1, align)).align).toEqual(["", expected]);
  });

  it("leaves every cell's text alone", () => {
    expect(parseTable(setAlignment(table, 0, "right")).rows).toEqual(parseTable(table).rows);
  });
});

describe("moving", () => {
  const table = ["| a  |   b |", "|:---|----:|", "| 1  |   2 |", "| 3  |   4 |"];

  it("moves a row and leaves the delimiter in place", () => {
    expect(moveRow(table, 2, 1)).toEqual([table[0], table[1], table[3], table[2]]);
    expect(moveRow(table, 0, 1)).toEqual([table[2], table[1], table[0], table[3]]);
  });

  it("ignores a move to the same place or out of range", () => {
    expect(moveRow(table, 1, 1)).toBe(table);
    expect(moveRow(table, 1, 9)).toBe(table);
    expect(moveColumn(table, 0, 0)).toBe(table);
    expect(moveColumn(table, 0, 5)).toBe(table);
  });

  it("moves a column with its padding and its alignment marker", () => {
    expect(moveColumn(table, 0, 1)).toEqual(["|   b | a  |", "|----:|:---|", "|   2 | 1  |", "|   4 | 3  |"]);
  });

  it("keeps escaped pipes inside their cell", () => {
    expect(moveColumn(["| x \\| y | z |", "|---|---|"], 0, 1)[0]).toBe("| z | x \\| y |");
  });

  it("keeps a table without outer pipes valid", () => {
    expect(moveColumn(["a | b", "--- | ---", "1 | 2"], 0, 1)).toEqual(["b | a", "--- | ---", "2 | 1"]);
  });

  it("gives a short row the cells it needs to move", () => {
    expect(moveColumn(["| a | b |", "|---|---|", "| 1 |"], 0, 1)[2]).toBe("|  | 1 |");
  });
});
