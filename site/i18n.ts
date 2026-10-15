/**
 * The welcome page's copy in 简体中文. The English is the page's markup itself (site/index.html),
 * so it is what shows without JavaScript; each translated element carries a `data-i18n` key (its
 * inner HTML), `data-i18n-aria` (its aria-label) or `data-i18n-title` (its tooltip). The generated
 * preset labels bring their Chinese in `data-zh` instead (site/presets.ts).
 *
 * Wording follows the configurator's own Chinese (web/src/i18n/zh.ts) wherever the two meet: 语言,
 * 外观, 跟随系统, 浅色, 深色, the preset names. Values are HTML: they may carry the same inline
 * markup as the English (<em>, <kbd>, <code>, <a>) and are only ever this file's own strings.
 */
export const ZH: Record<string, string> = {
  "doc.title": "super-statusline — 在浏览器里设计你的 Claude Code 状态栏",
  skip: "跳到正文",
  "nav.aria": "网站",
  "nav.presets": "预设",
  "nav.arrange": "拖拽",
  "nav.try": "试一试",
  "nav.install": "安装",
  "pref.language": "语言",
  "pref.appearance": "外观",
  "pref.system": "跟随系统",
  "pref.light": "浅色",
  "pref.dark": "深色",

  "hero.kicker": "Claude Code 插件 · 开源，MIT 协议",
  // Kept-together runs: Chinese breaks between any two characters, and "设 / 计" split a word on a phone.
  "hero.title": '<span class="lp-nowrap"><em>在浏览器里</em>设计</span><br class="lp-desk" /><span class="lp-nowrap">你的</span> Claude Code <span class="lp-nowrap">状态栏</span>',
  "hero.lead": "选一个预设，把组件拖到想要的位置，真实的状态栏会对着你自己的会话实时重绘——不用手改 JSON。",
  "hero.try": "试用配置器",
  "hero.see": "看看效果",
  "hero.label": "01 · 从预设开始",
  "hero.engine": "真实引擎渲染 · 示例会话",
  "hero.note": "120 列宽的真实渲染。状态栏从不换行，所以这里可以左右滑动。",
  "term.aria": "三个预设在示例会话上的渲染：极简一行，标准两行，完整四行",
  "term.bar": "三个预设 · 同一个会话",
  "term.swipe": "左右滑动 →",

  "arrange.label": "02 · 排布",
  "arrange.title": "再拖成你想要的样子。",
  "arrange.text": "每个组件都是一块小卡片。在行与左右区域之间拖动它们——每放下一次，预览就重绘一次。",
  "step1.title": "从托盘拖出来",
  "step1.text": "把 39 个组件中的任意一个拖到某一行的左侧或右侧区域。",
  "step2.title": "拖动来调整",
  "step2.text": "在一行内调整顺序，或移到另一行。用键盘：聚焦组件，再按 <kbd>Alt</kbd> + 方向键。",
  "step3.title": "拖回去就移除",
  "step3.text": "把它放回托盘，它就离开了状态栏。",
  "video.aria": "配置器录屏：把“改动行数”从托盘拖到第 1 行，把“会话费用”移到第 2 行，再把“上次回复”拖回托盘，每次放下后状态栏预览都会重绘",
  "video.caption": "录自下方的配置器",
  callout: "可交互的配置器在本页的桌面版里——换到大屏幕上就能试用。",

  "try.label": "04 · 试一试",
  "try.title": "这就是真正的配置器。",
  "try.text": "它就在这里运行，用的是示例会话——继续往下滚动即可一路体验。你的改动只保存在这个浏览器里。",
  "try.tag": "在线演示 · 示例会话",

  "install.label": "03 · 安装",
  "install.title": "一条命令，就归你了。",
  "install.text": '它会检查 Claude Code（2.1.251 及以上）和 <a href="https://bun.sh">Bun</a>——缺少 Bun 时会提出帮你安装——然后安装插件。以后随时再运行一次即可更新。',
  "install.terminal": "终端",
  "copy.aria": "复制安装命令",
  "install.then":
    '然后在 Claude Code 里运行 <code>/super-statusline:config</code>，选一个布局。想手动安装，或先看看脚本？见 <a href="https://github.com/jinhuang712/claude-super-statusline/blob/main/INSTALL.md">INSTALL.md</a>。',

  "foot.aria": "项目",
  "foot.credit": 'MIT · 数据层源自 <a href="https://github.com/jarrodwatts/claude-hud">claude-hud</a>',
};

/** The copy button's states, which change with a click rather than live in the markup. */
export const COPY_LABELS = {
  en: { copy: "Copy", copied: "Copied", selected: "Selected" },
  zh: { copy: "复制", copied: "已复制", selected: "已选中" },
} as const;
