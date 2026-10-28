// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourcePicker } from "./ResourcePicker";
afterEach(cleanup);
test("search adds available resources and removal does not delete the library entry", () => {
  function Example() {
    const [selected, setSelected] = useState(["old"]);
    return (
      <ResourcePicker
        title="Skill"
        selected={selected}
        items={[
          { id: "old", name: "旧版" },
          { id: "new", name: "报告" },
          { id: "disabled", name: "已停用", disabled: true },
        ]}
        onAdd={(id) => setSelected([...selected, id])}
        onRemove={(id) => setSelected(selected.filter((i) => i !== id))}
      />
    );
  }
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "添加Skill" }));
  expect(screen.queryByRole("button", { name: "添加 已停用" })).toBeNull();
  fireEvent.change(screen.getByLabelText("搜索Skill"), {
    target: { value: "报告" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加 报告" }));
  expect(screen.getByRole("button", { name: "移除 旧版" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "移除 报告" }));
  expect(screen.getByRole("button", { name: "添加 报告" })).toBeTruthy();
});
