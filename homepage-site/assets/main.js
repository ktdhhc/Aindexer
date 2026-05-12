const THEME_KEY = "aindexer-homepage-theme";

const guideSections = [
  {
    label: "01",
    title: "开始前需要准备什么",
    blocks: [
      {
        type: "list",
        title: "确认三件事",
        items: [
          "配置-provider-选择其中一个模型-点击测试是否成功",
          "配置-字段模板-是否存在模板",
          "配置-默认配置-是否选好默认模型"
        ]
      },
      {
        type: "note",
        title: "别等到上传完才回头配环境",
        paragraphs: [
          "如果后面要用到问答、索引或翻译，不要等到上传完文献才想起模型服务还没配。"
        ]
      }
    ]
  },
  {
    label: "02",
    title: "Provider、模型和 API Key（新手必看）",
    blocks: [
      {
        type: "list",
        title: "这几个词分别指什么",
        items: [
          "Provider是提供ai模型服务的供应商（可以理解为网络运营商），国内比较大的供应商有阿里百炼、火山引擎、腾讯云等。只提供自家产品的服务的也有不少，比如深度求索（DeepSeek）、月之暗面（Kimi）、智谱（GLM）等",
          "模型是指部署在供应商服务器上的ai模型",
          "API是实际调用模型能力的渠道，API Key 则是访问的密钥。",
          "Aindexer可以替你暂时托管这些配置，但必须自己保存一份（包括base url和api key）。"
        ]
      },
      {
        type: "note",
        title: "配置不是摆设",
        paragraphs: [
          "这一步配得顺，后面上传、整理、问答和翻译都会更稳。"
        ]
      },
      {
        type: "text",
        title: "获取和导入API（以deepseek为例）",
        paragraphs: [
          "搜索 deepseek platform，首次登录的话需注册"
        ]
      },
      {
      type: "image",
      title: "第一步：创建API key",
      src: "../assets/guide/配置1.png"
      },
      {
      type: "image",
      title: "第二步：点击接口文档，找到base url和模型名",
      src: "../assets/guide/配置2.png"
      },
      {
      type: "image",
      title: "第三步：在Aindexer中保存和测试API",
      src: "../assets/guide/配置3.png"
      },
    ]
  },
  {
    label: "03",
    title: "什么是索引，为什么它需要等待",
    blocks: [
      {
        type: "text",
        title: "索引在这里是指让 AI 根据固定模板生成的结构化总结",
        paragraphs: [
          "上传文献之后，Aindexer 会调用你配置的模型，把一篇论文整理成可搜索、可编辑的记录。这一步叫做索引。",
          "索引不只是在后台跑一个任务，它决定了这篇文献后面能不能被搜索到、能不能被问答引用、能不能被你长期回看。",
          "索引完成后，结果会同时存进数据库和 Markdown 文件，你可以在文献画布里直接打开编辑。"
        ]
      },
      {
        type: "image",
        title: "上传后进入索引阶段",
        src: "../assets/guide/索引运行中.png",
        alt: "文献索引运行中界面示意",
        caption: "[截图占位：请截一张 Workbench 里文献正在索引、显示进度状态的界面。]"
      },
      {
        type: "text",
        title: "等待时间取决于什么",
        paragraphs: [
          "等待时长主要来自三个方面：文献本身的长度、你选的模型响应速度，以及当前的网络状态。",
          "长文献、高峰期调用、模型限速，都会让等待变长，并不是软件卡住了。"
        ]
      },
      {
        type: "list",
        title: "索引过程中你可以做什么",
        items: [
          "查看进度：文献列表里会显示当前阶段（parsing → llm_request → writing）",
          "中途取消：如果等太久，可以取消当前索引，换个更快的模型重新跑",
          "批量跑：同时选中多篇文献，一次性发起索引，系统会按并发量排队执行",
          "先去干别的：索引是异步的，不需要一直盯着页面"
        ]
      },
      {
        type: "note",
        title: "提高索引效率",
        paragraphs: [
          "在「配置 → 默认配置」中可以调整并发量，允许同时生成多篇索引，适合文献量大的时候批量处理。",
          "索引失败不等于这篇文献废了：失败时会自动生成一份 fallback 模板，并把文献标记为「待修订」，你仍然可以基于模板继续手动整理。"
        ]
      }
    ]
  },
  {
    label: "04",
    title: "字段模板：决定索引会生成什么",
    blocks: [
      {
        type: "text",
        title: "索引不是随意生成的，它按照你选的模板来组织",
        paragraphs: [
          "字段模板是一套预设的栏目结构，告诉 AI 应该从这篇文献里提取哪些维度的信息。每一篇文献运行索引时，都必须关联一个模板。",
          "模板里的字段可以是默认的（如摘要、核心观点、研究方法），也可以是你自己加的自定义字段。不同课题、不同学科，对文献的关注点不一样，模板就帮你把关注点固化下来。"
        ]
      },
      {
        type: "list",
        title: "模板常用的默认字段",
        items: [
          "标题 / 作者 / 年份：文献的基本元信息",
          "摘要 / 核心观点：AI 提取的主要论点和判断",
          "研究方法 / 实验设计：这篇论文用了什么方法",
          "局限性：作者声明或 AI 识别的研究限制",
          "自定义字段：你可以自己加，比如「样本量」「数据集」「参考文献」等"
        ]
      },
      {
        type: "image",
        title: "字段模板管理界面示意",
        src: "../assets/guide/字段模板.png",
        alt: "字段模板管理界面示意",
        caption: "[截图占位：请截一张「配置 → 字段模板」页面的截图，能看到模板列表和字段编辑区域。]"
      },
      {
        type: "text",
        title: "什么时候需要自己建模板",
        paragraphs: [
          "如果你的研究方向有特定的信息需求，比如做体系结构的人关心「实验平台」「基准测试集」，做医学的人关心「样本量」「p 值」，这些都可以通过自定义字段来固定。",
          "建好模板后，索引会按这个模板去提取信息。同一个工作区可以使用不同的模板，适合文献类型混合的场景。"
        ]
      },
      {
        type: "note",
        title: "模板选对了，索引才有用",
        paragraphs: [
          "索引的质量很大程度上取决于模板和文献类型的匹配程度。如果你发现每次索引完都要手动补很多字段，可能不是 AI 的问题，而是模板没有配对。",
          "建议在正式批量索引之前，先拿一两篇文献跑一次，看看模板的输出质量，调整好再批量跑。"
        ]
      }
    ]
  },
  {
    label: "05",
    title: "如何阅读和修订索引结果",
    blocks: [
      {
        type: "text",
        title: "索引结果不是终稿，人工修订才是核心",
        paragraphs: [
          "索引跑完之后，你会看到一篇结构化的文献记录，包含摘要、核心观点、研究方法、局限性和其他自定义字段。",
          "这里更像一张编辑台，而不只是「查看结果」。你可以直接在画布里修改任何字段，补上自己的笔记，或者纠正 AI 的判断。",
          "目的不是让 AI 替你读论文，而是让它先帮你搭好框架，你再把它慢慢改成自己以后还愿意回看的记录。"
        ]
      },
      {
        type: "list",
        title: "拿到索引后先看这几项",
        items: [
          "摘要：是否准确概括了论文主旨",
          "核心观点 / claims：AI 提取的论点是否对应原文",
          "研究方法：方法名、样本量、实验设计是否写对",
          "局限性：有没有遗漏作者自己声明的重要限制",
          "自定义字段：对照你选的字段模板，检查是否都填上了"
        ]
      },
      {
        type: "text",
        title: "修订之后还能做什么",
        paragraphs: [
          "修订完可以直接在画布里导出 Markdown，放到你自己的笔记工具里继续用。",
          "修订越认真，后面搜索和问答就越容易精准定位到这篇文献。",
          "你补的备注和笔记同样会被纳入搜索范围，所以别只改 AI 生成的字段，也顺手写下自己当时的判断。"
        ]
      },
      {
        type: "note",
        title: "重要内容必须回原文核对",
        paragraphs: [
          "AI 生成的内容可能存在事实偏差。重要结论、数字、统计数据和引用位置，最好都回到原文确认一次，不要把生成结果直接当定稿。",
          "索引的原始 Markdown 文件保存在 data/indexes/ 目录下，你可以随时用外部编辑器打开查看。"
        ]
      }
    ]
  },
  {
    label: "06",
    title: "如何搜索自己的文献库",
    blocks: [
      {
        type: "text",
        title: "搜索不只是输入关键词",
        paragraphs: [
          "Aindexer 的搜索会覆盖标题、关键词、摘要、核心观点、claims、备注和你自己补充的所有笔记。",
          "很多时候你不是完全忘了那篇论文，而是只记得它大概说过什么。这时候从你记得的一句话、一个术语或者一个结论开始搜，往往比按文件名翻更快。",
          "搜索结果会直接定位到匹配的文献，点击就能进入画布查看完整记录。"
        ]
      },
      {
        type: "image",
        title: "搜索界面示意",
        src: "../assets/guide/搜索界面.png",
        alt: "文献搜索界面示意",
        caption: "[截图占位：请截一张搜索框输入关键词后显示搜索结果列表的界面。]"
      },
      {
        type: "list",
        title: "搜不到的几种常见原因",
        items: [
          "索引还没跑完：只有 indexed 状态的文献才会被纳入搜索",
          "修订不到位：你没补的关键词和备注，搜索也找不到",
          "关键词没对上：试试换一种表述，或者用更短的词",
          "文献不在当前工作区：检查一下是否切到了正确的工作区"
        ]
      },
      {
        type: "text",
        title: "搜索和问答怎么配合",
        paragraphs: [
          "搜索适合「我知道我要找什么」的场景，比如找某篇论文、找某个术语。",
          "问答的全景模式适合「我不确定该找什么」的场景，它会自动扫描当前工作区帮你筛选。",
          "两者不是替代关系：先搜到目标文献，再切换到精读模式围绕它们追问，是最顺手的用法。"
        ]
      },
      {
        type: "note",
        title: "搜索效果取决于你之前的投入",
        paragraphs: [
          "前面修订得越认真、补充的笔记越多，后面搜索就越容易把一篇旧文献重新接回当前问题。搜索不是独立功能，而是你长期整理之后的自然回报。"
        ]
      }
    ]
  },
  {
    label: "07",
    title: "工作区和文献分类建议",
    blocks: [
      {
        type: "text",
        title: "工作区是文献的第一层边界",
        paragraphs: [
          "工作区不是一个装饰功能，它决定了文献、索引、问答、翻译和用量统计的归属范围。",
          "同一个工作区里的文献可以被一起搜索、一起问答；不同工作区之间的数据完全隔离。",
          "所以你在创建工作区之前，先想清楚：这批资料以后会不会需要放在一起查、一起问。"
        ]
      },
      {
        type: "image",
        title: "工作区管理界面示意",
        src: "../assets/guide/工作区管理.png",
        alt: "工作区管理界面示意",
        caption: "[截图占位：请截一张「配置 → 工作区」页面的截图，能看到工作区列表和新建/切换操作。]"
      },
      {
        type: "list",
        title: "什么时候新建一个工作区",
        items: [
          "开始一个新课题或新项目",
          "资料之间完全不会同时用到",
          "想单独统计某个方向的用量和成本",
          "需要和已有的文献库保持清晰边界"
        ]
      },
      {
        type: "text",
        title: "怎么分不会乱",
        paragraphs: [
          "前期不要求分得太细。有人一上来就按「论文类型 × 年份 × 研究方向」建十几个工作区，结果每回都要先想「这篇到底该放哪」。",
          "建议从粗粒度开始：如果几批资料以后可能会在同一轮问答里用到，就放在同一个工作区。等文献量真的多到不好找的时候，再拆。",
          "工作区名字建议写清楚课题或方向，避免用「临时」「测试」这种过几天就不知道指什么的名字。"
        ]
      },
      {
        type: "note",
        title: "先求能找回，再求分得精细",
        paragraphs: [
          "分类的目的不是让目录看起来整齐，而是让你在几周甚至几个月后还能准确找到那篇文献。前期先保证搜得到，再慢慢把边界调清楚。",
          "如果某天发现某个工作区里文献太多、不好找了，那时候再拆也不迟。"
        ]
      }
    ]
  },
  {
    label: "08",
    title: "问答的三种模式该怎么选",
    blocks: [
      {
        type: "text",
        title: "全景模式：不指定文献，先看全局",
        paragraphs: [
          "全景模式会把当前工作区里的文献一次性扫一遍，帮你做横向比较和筛选。",
          "你不知道哪些文献和问题有关、想先看看有没有相关材料、需要按主题或方法筛文献，这种时候用它最合适。"
        ]
      },
      {
        type: "list",
        title: "适合这样问",
        items: [
          "这个工作区里有哪些文献讨论了 X？",
          "帮我筛出使用了某种方法的论文",
          "按发表时间列一下当前工作区里的主要结论",
          "我这批文献里有没有互相矛盾的观点"
        ]
      },
      {
        type: "note",
        title: "全景模式的边界",
        paragraphs: [
          "如果文献太多，它不会硬把所有内容都塞进去，而是先给一份结构化的全景摘要。这不是漏掉了，是防止信息过载。",
          "如果你需要深入某一篇文献，全景模式不是首选，请换到精读模式。"
        ]
      },
      {
        type: "text",
        title: "精读模式：自己指定文献，围着它们深挖",
        paragraphs: [
          "精读模式最稳当——你先圈好想看的文献，它只围绕你选的材料回答。",
          "你需要比较两篇论文的实验设计、基于指定文献写一段综述、或者对照原文核结论，这种场景下精读模式比另外两种更靠谱。",
          "使用时先在输入框里用 @ 呼出文献列表，选中后系统就只在你圈定的范围内找答案。"
        ]
      },
      {
        type: "list",
        title: "适合这样问",
        items: [
          "比较这两篇论文的实验设计差异",
          "基于这三篇文献，帮我梳理当前研究方向的主要争议",
          "分析这篇论文的局限和可能的偏差",
          "把这些文献的结论串成一段综述"
        ]
      },
      {
        type: "note",
        title: "精读模式的边界",
        paragraphs: [
          "必须先指定文献，否则它不知道该看什么。",
          "回答质量取决于你选的文献和你提的问题是否真正匹配。不是选得越多越好，吻合度比数量重要。"
        ]
      },
      {
        type: "text",
        title: "探索模式：把决定权交给 AI",
        paragraphs: [
          "探索模式最自由，你只需要提出问题，系统自己决定先看哪些文献、再补哪些材料，最后把结果汇总给你。",
          "适合你还没有明确思路、不确定该看哪些文献、或者问题本身需要多次查找和比对才能回答。",
          "运行过程中，界面会显示它正在看什么文献，你也可以随时中断。"
        ]
      },
      {
        type: "list",
        title: "适合这样问",
        items: [
          "帮我找和这个研究方向最相关的材料，然后总结一下",
          "你自己判断应该先看哪些文献再回答",
          "梳理这个领域的整体脉络，把你认为关键的文献挑出来"
        ]
      },
      {
        type: "note",
        title: "探索模式的边界",
        paragraphs: [
          "它会自己决定读哪些文献，所以回答可能和你的预期不完全一致。如果你对范围有明确要求，建议先试试精读模式。",
          "单次提问如果涉及太多文献，等待时间会比较长。问题越具体，结果越可控。",
          "探索模式的结果不要直接当作定稿，最好回到原文确认关键结论。"
        ]
      },
      {
        type: "text",
        title: "三种模式的共同规则",
        paragraphs: [
          "无论你选哪种模式，一条规则是通用的：新建会话时先选模式，第一个问题发出后就锁定了。如果想换模式，需要新建一个会话。"
        ]
      },
      {
        type: "list",
        title: "快速判断自己该选哪个",
        items: [
          "先扫一眼有哪些文献 → 全景模式",
          "已经知道要看哪几篇 → 精读模式",
          "完全没头绪，先问再说 → 探索模式"
        ]
      }
    ]
  },
  {
    label: "09",
    title: "数据、隐私与备份",
    blocks: [
      {
        type: "text",
        title: "你的数据存在哪里",
        paragraphs: [
          "Aindexer 的所有数据默认落在本地目录下。数据库是 SQLite 文件，上传的文献原文放在 uploads 子目录，索引结果以 Markdown 文件保存在 indexes 子目录，导出文件和备份包存在 exports 子目录。",
          "没有云端同步、没有自动上传、没有隐藏的数据外传路径。你的文献和笔记，只有你在本地看得到。"
        ]
      },
      {
        type: "image",
        title: "导出与备份界面示意",
        src: "../assets/guide/数据备份.png",
        alt: "数据导出与备份界面示意",
        caption: "[截图占位：请截一张导出或备份相关的界面，能看到可导出的内容类型和操作按钮。]"
      },
      {
        type: "list",
        title: "定期备份建议备份哪些",
        items: [
          "整个 data 目录：包含数据库、上传文件、索引 Markdown、日志",
          "导出的备份包：可以从页面里一键导出全量备份文件",
          "自己补充的截图和笔记：这些不在 Aindexer 目录里，需要单独管理"
        ]
      },
      {
        type: "text",
        title: "换设备或重装系统前怎么做",
        paragraphs: [
          "先在页面里执行一次全量备份，导出一个备份包。把备份包和整个 data 目录一起拷贝到新设备上，再在新设备的 Aindexer 里恢复备份。",
          "不要只拷数据库文件。数据库里存的是结构化数据，但文献原文和索引 Markdown 是独立文件，缺了它们文献会打不开。"
        ]
      },
      {
        type: "text",
        title: "哪些数据会离开本机",
        paragraphs: [
          "当你使用索引、问答或翻译功能时，Aindexer 会把当前文献的相关文本发送给你配置的模型服务。发送的具体内容取决于你当前的操作：索引会发送文献原文，问答会发送索引记录和你的问题，翻译会发送你选中的文本片段。",
          "除此之外，不会发送任何其他数据。不涉及文献库列表、工作区结构、你的配置信息或用量统计。"
        ]
      },
      {
        type: "note",
        title: "敏感资料的处理原则",
        paragraphs: [
          "如果你的文献包含未公开的研究数据、涉密内容或受协议保护的材料，在使用索引、问答或翻译功能之前请先确认是否允许将这些文本发送给第三方模型服务。",
          "如果你不确定某篇文献能不能发，可以先不上传，或者只上传可公开的部分。Aindexer 不会在你不知情的情况下向外发送任何数据。"
        ]
      }
    ]
  },
  {
    label: "10",
    title: "常见问题与排查",
    blocks: [
      {
        type: "text",
        title: "遇到问题先做三件事",
        paragraphs: [
          "大部分故障不是软件坏了，而是某一步的依赖条件没满足。遇到问题不要急着卸载或重装，先按下面的顺序排查。"
        ]
      },
      {
        type: "list",
        title: "第一步：检查配置",
        items: [
          "Provider 是否填对了 Base URL",
          "API Key 是否在有效期内、额度是否用完",
          "默认模型是否已选择",
          "在配置页点一下测试连接，确认模型能正常响应"
        ]
      },
      {
        type: "list",
        title: "第二步：检查文件",
        items: [
          "PDF 是否可读（扫描版、图片型 PDF 比文字型更难处理）",
          "文件是否已损坏（试试用其他阅读器打开）",
          "文件是否太大（超大 PDF 可能导致解析超时）"
        ]
      },
      {
        type: "list",
        title: "第三步：检查网络",
        items: [
          "本地网络是否能访问模型服务的地址",
          "是否需要代理或者 VPN",
          "模型服务端是否在维护或限速"
        ]
      },
      {
        type: "text",
        title: "按场景排查",
        paragraphs: [
          "以下是最常遇到的几种情况，每种都有对应的排查思路。如果下面没有你的问题，或者按步骤排查后仍然失败，可以到 GitHub Issues 里搜索或提交新的问题。"
        ]
      },
      {
        type: "list",
        title: "上传失败",
        items: [
          "检查文件格式是否支持（PDF、TXT、DOCX）",
          "检查文件是否已损坏或为 0 字节",
          "检查当前工作区是否存在"
        ]
      },
      {
        type: "list",
        title: "索引一直没反应或失败",
        items: [
          "确认模型测试连接是否通过",
          "检查 API Key 额度是否已用完或被限速",
          "换一个更快的模型试一次",
          "查看日志文件（data/logs/ 目录下）了解具体错误信息"
        ]
      },
      {
        type: "list",
        title: "翻译没有结果",
        items: [
          "确认已上传的 PDF 是文字型而非纯扫描图片",
          "检查翻译功能是否配置了可用的模型",
          "尝试选取更短的文本片段测试是否能正常返回"
        ]
      },
      {
        type: "list",
        title: "问答没有响应或回答为空",
        items: [
          "确认当前工作区里至少有一篇已索引的文献",
          "检查提问的会话模式是否匹配你的需求",
          "尝试换一个模型或缩短问题再试"
        ]
      },
      {
        type: "list",
        title: "搜索不到文献",
        items: [
          "确认文献已索引完成（状态为 indexed）",
          "检查是否切到了正确的工作区",
          "试试用更短的关键词或论文标题中的原词"
        ]
      },
      {
        type: "note",
        title: "实在解决不了怎么办",
        paragraphs: [
          "如果按照上面的步骤排查后问题依然存在，可以先查看 data/logs/ 目录下的日志文件，把最近的错误日志和你的操作步骤一起带上，到 GitHub Issues 里说明情况。",
          "描述问题时尽量写清楚：你做了哪几步操作、在哪一步出现了什么现象、有没有报错提示。信息越具体，越容易定位。"
        ]
      }
    ]
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderParagraphs(paragraphs = []) {
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function renderGuideBlock(block) {
  const title = block.title ? `<h3>${escapeHtml(block.title)}</h3>` : "";

  if (block.type === "list") {
    return `
      <section class="doc-block doc-block-list">
        ${title}
        <ul>
          ${(block.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  if (block.type === "image") {
    const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
    return `
      <section class="doc-block doc-block-image">
        ${title}
        <figure class="doc-image">
          <img src="${escapeHtml(block.src || "")}" alt="${escapeHtml(block.alt || "")}" loading="lazy" />
          ${caption}
        </figure>
      </section>
    `;
  }

  if (block.type === "html") {
    return `
      <section class="doc-block doc-block-html">
        ${title}
        ${block.html || ""}
      </section>
    `;
  }

  const variantClass = block.type === "note" ? " doc-block-note" : "";
  return `
    <section class="doc-block${variantClass}">
      ${title}
      ${renderParagraphs(block.paragraphs || [])}
    </section>
  `;
}

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
  const guideBlocks = document.getElementById("guideBlocks");
  const guideNav = document.getElementById("guideNav");
  let activeGuideIndex = 0;

  function setGuide(index) {
    activeGuideIndex = index;
    const item = guideSections[index];
    guideChapter.textContent = item.label;
    guideTitle.textContent = item.title;
    guideIntro.textContent = item.intro;
    guideBlocks.className = "guide-blocks";
    guideBlocks.innerHTML = (item.blocks || []).map(renderGuideBlock).join("");
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
