const THEME_KEY = "aindexer-homepage-theme";

const guideSections = [
  {
    label: "01",
    title: "开始前需要准备什么",
    intro: "第一次打开前，先把会影响后续体验的几件事准备好。",
    main: "先确认手里是什么文件，准备放进哪个工作区，再看本机环境和网络是否满足基本运行条件。文献文件越规整，后面整理起来越省力。",
    tip: "如果后面要用到问答、索引或翻译，不要等到上传完文献才想起模型服务还没配。"
  },
  {
    label: "02",
    title: "什么是 Provider、模型和 API Key",
    intro: "这一步不是抽象概念，而是决定功能能不能真正跑起来。",
    main: "Provider 可以理解成模型服务的入口，模型是你实际调用的能力，API Key 则是访问凭证。Aindexer 不替你托管这些配置，而是把它们接到你自己的工作流里。",
    tip: "API Key 虽然不是账号密码，但也不要出现在公开截图、仓库提交或聊天记录里。"
  },
  {
    label: "03",
    title: "如何导入一篇文献",
    intro: "文献进库以后，后面的整理、翻译和问答才有落点。",
    main: "从上传入口把文献放进当前工作区。单篇适合边看边试，批量适合先把资料收齐。上传后先看列表状态和文件名，别急着一路点到底。",
    tip: "扫描版 PDF、图片型 PDF，或者排版很重的文件，后面往往会比普通正文 PDF 更难处理。"
  },
  {
    label: "04",
    title: "什么是索引，为什么它需要等待",
    intro: "索引不是装饰步骤，它决定文献后面能不能被继续利用。",
    main: "Aindexer 会把文献整理成可搜索、可编辑的记录，方便你后面回看、修订和追问。等待时间通常来自文献长度、网络状态和模型响应，而不是界面卡住。",
    tip: "长文献、网络波动和模型限速都会拉长等待时间；就算失败，也不代表这篇文献完全不能继续整理。"
  },
  {
    label: "05",
    title: "如何阅读和修订索引结果",
    intro: "这一页更像编辑台，不像只读结果页。",
    main: "打开文献记录后，重点看摘要、观点、方法、限制和你自己的补充备注。这里不是验收 AI 结果，而是把一篇文献慢慢改成你以后还愿意回看的笔记。",
    tip: "重要结论、数字和引用位置，最好都回到原文核对一次，不要把生成内容直接当定稿。"
  },
  {
    label: "06",
    title: "如何搜索自己的文献库",
    intro: "搜索不是最后一步，而是文献库开始有价值的时刻。",
    main: "可以从关键词、主题词、摘要、备注或你记得的一句话开始找。很多时候你不是完全忘了那篇论文，而是只记得它大概说过什么。",
    tip: "前面修订得越认真，后面就越容易把一篇旧文献重新接回当前问题。"
  },
  {
    label: "07",
    title: "如何使用翻译辅助阅读",
    intro: "翻译页适合边读边看，不适合把原文整段丢进去就结束。",
    main: "先在原文里选取真正卡住你的片段，再看翻译结果是否帮助理解。必要时可以顺手摘录、保存，或者改成更贴近你自己阅读习惯的表达。",
    tip: "机器翻译更适合理解原意，不适合直接拿去做正式引用或最终表述。"
  },
  {
    label: "08",
    title: "工作区和文献分类建议",
    intro: "分类的目的不是好看，而是让资料能长期留得住、找得到。",
    main: "工作区可以按课题、课程、项目或研究方向来分。先把边界分清，再决定哪些文献该放在一起，不用一开始就追求特别细的标签体系。",
    tip: "前期先求能找回，再求分得精细；分类太快、太细，反而容易把自己困住。"
  },
  {
    label: "09",
    title: "常见问题与排查",
    intro: "大部分问题都能定位，只是别一上来就把责任全推给软件。",
    main: "上传失败、索引失败、翻译没有响应、结果为空，通常都能沿着文件、网络、模型配置这几条线往回查。先看当前步骤依赖什么，再判断是哪一环断了。",
    tip: "很多报错都和 API Key、额度、超时或模型服务状态有关，不一定是页面本身出了问题。"
  },
  {
    label: "10",
    title: "数据、隐私与备份",
    intro: "资料会越积越多，这一节决定你以后敢不敢长期用它。",
    main: "文献文件、整理结果和导出内容都值得定期备份。准备换设备时，也别只拷数据库，最好把相关文件和导出包一起整理好。",
    tip: "只要调用外部模型服务，部分文本就可能离开本机；遇到敏感资料时，先想清楚再发。"
  }
];

function setTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;
  themeToggle.innerHTML = isDark ? "☀ <span>浅色</span>" : "☾ <span>暗色</span>";
  themeToggle.setAttribute("aria-label", isDark ? "切换浅色模式" : "切换暗色模式");
}

function initTheme() {
  const stored = window.localStorage.getItem(THEME_KEY);
  const preferredDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(stored ? stored === "dark" : preferredDark);

  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;
  themeToggle.addEventListener("click", () => {
    const nextDark = !document.body.classList.contains("dark");
    setTheme(nextDark);
    window.localStorage.setItem(THEME_KEY, nextDark ? "dark" : "light");
  });
}

function renderGuideNav(activeGuideIndex) {
  const guideNav = document.getElementById("guideNav");
  if (!guideNav) return;
  guideNav.innerHTML = guideSections.map((item, index) => `
    <button type="button" data-guide-index="${index}" class="${index === activeGuideIndex ? "active" : ""}">
      <small>${item.label}</small>
      <span>${item.title}</span>
    </button>
  `).join("");
}

function initGuidePage() {
  if (document.body.dataset.page !== "guide") return;

  const guideChapter = document.getElementById("guideChapter");
  const guideTitle = document.getElementById("guideTitle");
  const guideIntro = document.getElementById("guideIntro");
  const guideMain = document.getElementById("guideMain");
  const guideTip = document.getElementById("guideTip");
  const guideNav = document.getElementById("guideNav");
  let activeGuideIndex = 0;

  function setGuide(index) {
    activeGuideIndex = index;
    const item = guideSections[index];
    guideChapter.textContent = item.label;
    guideTitle.textContent = item.title;
    guideIntro.textContent = item.intro;
    guideMain.textContent = item.main;
    guideTip.textContent = item.tip;
    renderGuideNav(activeGuideIndex);
  }

  guideNav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-guide-index]");
    if (!button) return;
    setGuide(Number(button.getAttribute("data-guide-index")));
  });

  renderGuideNav(activeGuideIndex);
  setGuide(0);
}

initTheme();
initGuidePage();
