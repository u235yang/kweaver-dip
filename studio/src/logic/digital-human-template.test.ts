import { describe, expect, it } from "vitest";

import {
  buildTemplate,
  mergeFilesToTemplate,
  mergeTemplatePatch,
  parseIdentityMarkdown,
  renderIdentityMarkdown,
  renderSoulMarkdown,
  renderToolsMarkdown,
  resolveSoulTemplatePath,
  resolveToolsTemplatePath
} from "./digital-human-template";

describe("buildTemplate", () => {
  it("builds a template from a create request", () => {
    expect(
      buildTemplate({
        name: "A",
        creature: "B",
        soul: "C",
        bkn: [{ name: "n", id: "u" }]
      })
    ).toEqual({
      identity: { name: "A", creature: "B", icon_id: undefined },
      soul: "C",
      bkn: [{ name: "n", id: "u" }]
    });
  });

  it("defaults soul to empty string", () => {
    expect(buildTemplate({ name: "Only" }).soul).toBe("");
  });
});

describe("mergeTemplatePatch", () => {
  const base = {
    identity: { name: "N", creature: "C" },
    soul: "s",
    bkn: [{ name: "x", id: "y" }]
  };

  it("merges only provided keys", () => {
    expect(mergeTemplatePatch(base, { name: "New" })).toEqual({
      identity: { name: "New", creature: "C" },
      soul: "s",
      bkn: [{ name: "x", id: "y" }]
    });
  });

  it("clears creature when patch includes creature key as undefined", () => {
    const r = mergeTemplatePatch(base, { creature: undefined });
    expect(r.identity.creature).toBeUndefined();
  });

  it("replaces soul when provided", () => {
    expect(mergeTemplatePatch(base, { soul: "new" }).soul).toBe("new");
  });

  it("replaces bkn when provided", () => {
    expect(mergeTemplatePatch(base, { bkn: [] }).bkn).toEqual([]);
  });

  it("keeps creature when patch omits creature key", () => {
    const merged = mergeTemplatePatch(base, { name: "OnlyName" });
    expect(merged.identity.creature).toBe("C");
  });
});

describe("parseIdentityMarkdown", () => {
  it("parses name and creature lines", () => {
    expect(
      parseIdentityMarkdown(
        "# IDENTITY.md\n\n- Name: Alice\n- Creature: Dev\n"
      )
    ).toEqual({ name: "Alice", creature: "Dev" });
  });

  it("parses icon_id from IDENTITY.md", () => {
    expect(
      parseIdentityMarkdown(
        "# IDENTITY.md\n\n- Name: Alice\n- Icon ID: icon-123\n- Creature: Dev\n"
      )
    ).toEqual({ name: "Alice", icon_id: "icon-123", creature: "Dev" });
  });

  it("skips lines without values", () => {
    expect(parseIdentityMarkdown("- Name:\n- Name: Z\n")).toEqual({ name: "Z" });
  });

  it("parses multiline bold label values from built-in identity templates", () => {
    expect(
      parseIdentityMarkdown(
        "- **Name:**\n  BKN Creator\n- **Creature:**\n  BKN 生命周期编排器\n"
      )
    ).toEqual({
      name: "BKN Creator",
      creature: "BKN 生命周期编排器"
    });
  });
});

describe("mergeFilesToTemplate", () => {
  it("merges identity and soul without BKN", () => {
    const t = mergeFilesToTemplate(
      "- Name: Bob\n",
      "Hello soul"
    );
    expect(t.identity.name).toBe("Bob");
    expect(t.soul).toBe("Hello soul");
    expect(t.bkn).toBeUndefined();
  });

  it("parses BKN table from soul", () => {
    const soul = `Text\n\n## 业务知识网络\n\n| 名称 | 地址 |\n|------|------|\n| Doc | https://x |\n`;
    const t = mergeFilesToTemplate("- Name: C\n", soul);
    expect(t.bkn).toEqual([{ name: "Doc", id: "https://x" }]);
  });
});

describe("renderIdentityMarkdown / renderSoulMarkdown", () => {
  it("renders identity with optional creature", () => {
    const md = renderIdentityMarkdown({
      identity: { name: "X", creature: "Y" },
      soul: ""
    });
    expect(md).toContain("- Name: X");
    expect(md).toContain("- Creature: Y");
  });

  it("renders identity with icon_id", () => {
    const md = renderIdentityMarkdown({
      identity: { name: "X", icon_id: "ico-1", creature: "Y" },
      soul: ""
    });
    expect(md).toContain("- Name: X");
    expect(md).toContain("- Icon ID: ico-1");
    expect(md).toContain("- Creature: Y");
  });

  it("renders soul without BKN scope fragments in de_agent_soul template", () => {
    const md = renderSoulMarkdown({
      identity: { name: "X" },
      soul: "body",
      bkn: [{ name: "a", id: "b" }]
    });
    expect(md).toContain("# 👤 角色定义");
    expect(md).toContain("> body");
    expect(md).toContain("严禁去列举业务知识网络");
    expect(md).toContain("严禁执行 `kweaver bkn list` 命令");
    expect(md).toContain("### 使用约束");
    expect(md).toContain("不允许查询其他业务知识网络");
    expect(md).not.toContain("## 业务知识网络");
    expect(md).not.toContain("以下为当前允许使用的业务知识网络：");
    expect(md).not.toContain("只允许从上述业务知识网络查询数据");
    expect(md).not.toContain("如果用户问题可能和以下的业务知识网络有关系");
    expect(md).not.toContain("请使用kweaver-core技能先从业务网络中查询相关信息");
    expect(md).not.toContain("> | a | b |");
    expect(md).toContain("## 归档与计划技能");
    expect(md).toContain("archive-protocol");
    expect(md).toContain("schedule-plan");
    expect(md).not.toContain("{{de_setting}}");
    expect(md).not.toContain("{{bkn_content}}");
  });

  it("renders secret-handling rules into generated SOUL files", () => {
    const md = renderSoulMarkdown({
      identity: { name: "X" },
      soul: "body"
    });

    expect(md).toContain("## 安全输出约束");
    expect(md).toContain("不得向普通用户输出密码、Token、Secret、API Key、Cookie、私钥或环境变量");
    expect(md).toContain("对用户仅展示密文、哈希摘要或 `***` 形式的占位符");
    expect(md).toContain("`KEY=value`、`KEY: value`");
    expect(md).toContain("`TOKEN`、`SECRET`、`PASSWORD`、`API_KEY`、`COOKIE`、`PRIVATE_KEY`");
    expect(md).toContain("`OPENCLAW_*`、`KWEAVER_*`");
    expect(md).toContain("当前 `process.env` 中已知敏感值");
  });

  it("extracts soul only from blockquotes (allows > without space after >)", () => {
    const md = renderSoulMarkdown({
      identity: { name: "n" },
      soul: "紧凑引用",
      bkn: []
    });
    const fixed = md.replace("> 紧凑引用", ">紧凑引用");
    const back = mergeFilesToTemplate("- Name: n\n", fixed);
    expect(back.soul).toBe("紧凑引用");
  });

  it("strips HTML comments in persona block when parsing old SOUL files", () => {
    const raw = `# 👤 角色定义 (Custom Persona)
<!-- 角色设定：写入 {{de_setting}} 槽（Markdown，渲染为引用块） -->
> 纯角色一句
> **行为准则**：规则

## 业务知识网络

---
`;
    const t = mergeFilesToTemplate("- Name: x\n", raw);
    expect(t.soul).toBe("纯角色一句");
  });

  it("does not round-trip BKN rows through generated SOUL template", () => {
    const md = renderSoulMarkdown({
      identity: { name: "n" },
      soul: "s",
      bkn: [
        { name: "企业知识库", id: "https://kb.example.com" },
        { name: "企业知识库", id: "https://kb.example.com" }
      ]
    });
    const back = mergeFilesToTemplate("- Name: n\n", md);
    expect(back.bkn).toBeUndefined();
  });

  it("round-trips soul through SOUL template", () => {
    const md = renderSoulMarkdown({
      identity: { name: "n" },
      soul: "line1\nline2",
      bkn: [{ name: "Doc", id: "https://x" }]
    });
    const back = mergeFilesToTemplate("- Name: n\n", md);
    expect(back.soul).toContain("line1");
    expect(back.soul).toContain("line2");
    expect(back.bkn).toBeUndefined();
  });

  it("resolveSoulTemplatePath points at de_agent_soul.pug", () => {
    expect(resolveSoulTemplatePath()).toMatch(/de_agent_soul\.pug$/);
  });

  it("renders tools markdown from TOOLS template", () => {
    const md = renderToolsMarkdown();

    expect(md).toContain("# TOOLS.md");
    expect(md).toContain("## 投递通道消息");
  });

  it("resolveToolsTemplatePath points at TOOLS.md.pug", () => {
    expect(resolveToolsTemplatePath()).toMatch(/TOOLS\.md\.pug$/);
  });
});
