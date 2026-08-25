import type { NarratorEnvelope } from "./envelope.js";

/** Internal Engine markers that must never appear in player-facing prose. */
export const NARRATOR_LEAK_PATTERNS: RegExp[] = [
  /当前状态（权威）/,
  /最近场景（非权威/,
  /\bAuthority\b/,
  /\bCandidate\b/,
  /\bRevision\b/,
  /expectedRevision/,
  /\bValidator\b/,
  /Context packing/,
  /B层|C层|S层/,
  /A→B→C/,
  /\bsourceSeedId\b/,
  /\bsourceEventId\b/,
  /\bITEM_NOT_IN_REACH\b/,
  /\bLOCATION_NOT_REACHABLE\b/,
  /\bWORLD_NOT_FOUND\b/,
  /\bWORLD_SOURCE_\w+\b/,
  /"type"\s*:\s*"(character_move|item_carry|item_place|memory_note|claim_record)"/,
  /"(candidate|proposals|contributions|outcome)"\s*:/,
];

/** Returns true if text contains an internal Engine leak pattern. */
export function hasNarrationLeak(text: string): boolean {
  return NARRATOR_LEAK_PATTERNS.some((re) => re.test(text));
}

export const NARRATOR_SYSTEM = [
  "你是世界叙述者。你唯一的任务是：把已经允许你看见的信息写成玩家能读的故事场景。",
  "【严格视角规则】必须且始终使用第二人称「你」来叙述玩家的动作、感知和体验。严禁使用第三人称称呼玩家（例如绝不能写「赵明朗推开门」「林念安转过身」），玩家的名字只能出现在 NPC 呼唤玩家的名字时，或公函、信件等世界内文本当中。",
  "只写玩家在故事世界中实际看到、听到、感受到的事。严禁描写玩家不可感知的 NPC 内心活动。",
  "你可以增加语气、动作质感、环境氛围，以及不参与未来因果的临时细节。",
  "你不得单方面制造：位置变化、死亡、永久伤势、重要物品获得或消失、知识获得、重大能力、世界规则变化，或其他将来会参与因果的重要事实。",
  "已提交的后果只能当作已经发生的事来描写，不能加戏成新的事实。",
  "没有新的已提交后果时：禁止写「你已经到了」「你走进了」「你拿到了」「你放下了」这类完成态。",
  "被拒绝的持久企图不是降级后的『正在做』。不能描写已经摸到、抓住、整理肩带、背上、放下、走进或到达这些被拒绝的对象或地点。只能写意图、无法完成，以及已给出的可见失败原因。",
  "NPC 回复：保持他们说出口的意思，不要补充他们不知道的秘密。",
  "直接写场景故事。禁止出现：Authority、Candidate、Revision、权威层、非权威、Context、proposal、commit、数据库、B层、C层、S层、A→B→C、SQLite、sourceSeedId、sourceEventId、expectedRevision，或任何 JSON 字段名。",
  "不要用「当前状态」「最近场景」等内部结构标题开头。直接写叙事正文。",
  "使用 Markdown 格式提高可读性：段落分明、关键动作或对话可用 **粗体**，场景转换可用 ---，引用 NPC 对话用「」。",
  "你写的是文学化叙事，不是报告。不要每轮汇报世界数据库状态。",
].join("\n");

export const OPENING_SYSTEM = [
  "你是文字世界的第一幕引路人与叙述者。你的任务是为玩家拉开故事序幕，把玩家带入真实鲜活的当下世界。",
  "【叙事契约 5 要素】",
  "1. 锚定（Anchor）：第一段内明确交代玩家当前身处的具体地点、环境质感与 immediate 处境。",
  "2. 身份（Identity）：自然融入玩家的角色身份背景（如学生、旅人、普通市民等），让玩家感受到「这是我的人生」，但绝不生硬复述人物卡标签。",
  "3. 世界特异性（IP Specificity）：必须体现该世界与该时期的特异性元素（根据给出的公开背景与传闻），绝不能写成通用白开水。",
  "4. 推动钩子（Actionable Hook）：必须发生至少一件打破静止的、具体的、可处理的新事件（如有人叫你、电视插播紧急新闻、身边人神色慌张、门口滑入一张警告纸条、遗留物品等）。必须让玩家当下就可以对此做点什么，拒绝纯静止环境白描。",
  "5. 行动交接（Handoff）：结尾自然将局面推到关键节点，将行动权交还给玩家。",
  "【严格视角规则】必须全程使用第二人称「你」。严禁以第三人称（如「林念安…」）描写玩家自身！",
  "【字数与密度】叙事正文约 250–450 字，段落分明，每段都有新信息或事件增量。",
  "【严禁泄露隐秘】普通人不可知晓龙类、卡塞尔、混血种、言灵、尼伯龙根等内部机密，只能感知表面世界的日常与隐匿异常。",
  "【物理线索道具】如果场景中出现了玩家可以拾取、阅读、带走的新实体物品（如警告纸条、遗留信封、旧手机、车票等），请使用 <hook_item>物品名称</hook_item> 标出。",
  "【输出格式】请严格按照以下格式输出：",
  "<narrative>",
  "（这里写 250–450 字的第二人称开幕叙事正文，段落分明，使用 Markdown）",
  "</narrative>",
  "<hook_item>（可选：如果在场有可拾取实体物品，写物品名，如 警告纸条 / 遗留信封 / 旧手机，无实体则留空）</hook_item>",
  "【眼下】",
  "（一句话总结当前玩家面临的未决局面/焦点）",
  "【选项】",
  "A. （建设性/稳妥行动，自然语言，第一人称，如：我主动捡起地上的纸条仔细查看）",
  "B. （探索/观察行动，如：我仔细打量周围环境，看看有没有异常）",
  "C. （社交/询问行动，如：我转头找旁边的人打听刚才广播里的事情）",
  "D. （离开/自顾自处理自身事项的行动，如：我收拾好自己的书包，准备直接离开）",
  "E. （高风险/激进/强硬行动，如：我立刻推门追查刚才发出声音的人）",
  "F. （出人意料/整活/非常规社交奇招，如：我对着门外大喊「有话当面出来说」）",
].join("\n");

export interface OpeningHookPlan {
  kind: "durable_item" | "ephemeral_event";
  itemName?: string;
  itemContent?: string;
  situationSummary: string;
  narrativeDirective: string;
}

export function planOpeningHook(worldId: string, locationName: string): OpeningHookPlan {
  if (worldId === "riverside-inn" || locationName.includes("堂屋") || locationName.includes("客栈")) {
    return {
      kind: "durable_item",
      itemName: "警告纸条",
      itemContent: "别去后院地窖，今晚掌柜在提防生人。",
      situationSummary: "堂屋留有一张提醒别去地窖的警告纸条，掌柜神色有些异样。",
      narrativeDirective: "堂屋桌角或脚边出现一张【警告纸条】，上面写着『别去后院地窖，今晚掌柜在提防生人。』",
    };
  }
  if (worldId === "longzu" || locationName.includes("教学楼") || locationName.includes("学校") || locationName.includes("宿舍")) {
    return {
      kind: "durable_item",
      itemName: "警告信",
      itemContent: "别走老码头那条路，今晚雨夜有人在等。",
      situationSummary: "门缝滑入了一封未具名的警告信，外头汽车与电话声交织。",
      narrativeDirective: "门缝滑入一封【警告信】，上面写着『别走老码头那条路，今晚雨夜有人在等。』",
    };
  }
  if (worldId === "shenmi-fusu" || locationName.includes("居民楼")) {
    return {
      kind: "durable_item",
      itemName: "奇怪的便签",
      itemContent: "晚上听到敲门声千万别开，直接下楼。",
      situationSummary: "门把手上贴着一张警告不要开门的便签，楼道有些阴冷。",
      narrativeDirective: "门把手或门缝处贴着一张【奇怪的便签】，写着『晚上听到敲门声千万别开，直接下楼。』",
    };
  }
  if (worldId === "xiuxian" || locationName.includes("山门") || locationName.includes("大殿")) {
    return {
      kind: "durable_item",
      itemName: "传音符纸",
      itemContent: "后山有异动，巡夜弟子速至大殿集合。",
      situationSummary: "山门石阶旁落着一张闪烁微光的传音符纸，远处钟声回荡。",
      narrativeDirective: "石阶旁拾得一张【传音符纸】，上面留有字迹『后山有异动，巡夜弟子速至大殿集合。』",
    };
  }
  return {
    kind: "ephemeral_event",
    situationSummary: "周围的环境有些不同寻常的动向。",
    narrativeDirective: "远处传来一阵异样的声响与动静，打破了四周的平静。",
  };
}

export function hasPerspectiveViolation(text: string, playerName?: string): boolean {
  if (!playerName || playerName.trim().length < 2) {
    return false;
  }
  const cleanName = playerName.trim();
  // Strip quoted speech
  const nonDialogue = text
    .replace(/「[^」]*」/g, "")
    .replace(/“[^”]*”/g, "")
    .replace(/"[^"]*"/g, "");
  const pattern = new RegExp(`${cleanName}(把|推开|走|看|坐|拿|转|站|摸|想|说|听|从|在|正|低头|抬头|背着|迈|拿|望)`);
  return pattern.test(nonDialogue);
}

export interface OpeningPromptInput {
  worldTitle: string;
  era: string;
  timeLabel: string;
  publicPremise: string;
  locationName: string;
  presentCharacters: string[];
  publicRules: string[];
  publicLore: string[];
  publicBeat: string;
  profile: import("../persist/store.js").PlayerProfile;
  plannedHook?: OpeningHookPlan;
}

export function renderOpeningPrompt(input: OpeningPromptInput): string {
  const parts: string[] = [
    `【世界】${input.worldTitle}　【时期】${input.era}　【时间】${input.timeLabel}`,
    `【公开背景】${input.publicPremise}`,
    `【起始地点】${input.locationName}　【在场人物】${input.presentCharacters.join("、") || "（无）"}`,
    `【世界氛围与公共事件】${input.publicBeat || "（无）"}`,
  ];
  if (input.publicRules.length > 0) {
    parts.push(`【已知规则】${input.publicRules.join("；")}`);
  }
  if (input.publicLore.length > 0) {
    parts.push(`【公开资料与传闻】\n${input.publicLore.join("\n")}`);
  }
  const p = input.profile;
  parts.push(
    `【玩家身份】名字=${p.name}；年龄=${p.age ? p.age + "岁" : "18岁"}；性别=${p.gender || "未知"}；身世经历=${p.background || "普通人"}；性格=${p.personality || "务实"}；起始位置=${p.startingLocation || input.locationName}`,
  );
  if (input.plannedHook) {
    parts.push(`【本局开场既定事件（必须遵从描写）】${input.plannedHook.narrativeDirective}`);
  }
  parts.push("【要求】请严格以第二人称「你」写出富有特异性、忠实体现既定开场事件的第一幕场景，并给出【眼下】局面总结与 A–F 六个行动选项。");
  return parts.join("\n");
}

export interface ParsedOpening {
  narrative: string;
  currentSituation: string;
  suggestions: import("../http/view.js").ActionSuggestion[];
  hookItem?: string;
}

export function parseOpeningOutput(raw: string, defaultLoc: string = "这里", plan?: OpeningHookPlan): ParsedOpening {
  let narrative = "";
  let currentSituation = plan?.situationSummary ?? "";
  let hookItem: string | undefined = plan?.itemName;
  const suggestions: import("../http/view.js").ActionSuggestion[] = [];

  const narrativeMatch = raw.match(/<narrative>([\s\S]*?)<\/narrative>/i);
  if (narrativeMatch) {
    narrative = narrativeMatch[1]!.trim();
  } else {
    const splitIdx = raw.search(/【(眼下|选项)】|<hook_item>/);
    narrative = (splitIdx > 0 ? raw.slice(0, splitIdx) : raw).trim();
  }

  const sitMatch = raw.match(/【眼下】\s*([^\n]+)/);
  if (sitMatch) {
    currentSituation = sitMatch[1]!.trim();
  }

  const keys: Array<"A" | "B" | "C" | "D" | "E" | "F"> = ["A", "B", "C", "D", "E", "F"];
  for (const k of keys) {
    const optMatch = raw.match(new RegExp(`(?:^|\\n)\\s*${k}[.、:：]\\s*([^\\n]+)`));
    if (optMatch) {
      const type = k === "E" ? "extreme" : k === "F" ? "absurd" : "constructive";
      suggestions.push({
        key: k,
        label: optMatch[1]!.trim().replace(/^[（(][^）)]+[）)]\s*/, ""),
        type,
      });
    }
  }

  if (suggestions.length < 4) {
    suggestions.length = 0;
    suggestions.push(
      { key: "A", label: "主动探问眼前的异常情况", type: "constructive" },
      { key: "B", label: "仔细观察四周环境与身旁的人", type: "constructive" },
      { key: "C", label: "暂时按兵不动，先做自己手头的事", type: "constructive" },
      { key: "D", label: `收拾好东西，离开${defaultLoc}`, type: "constructive" },
      { key: "E", label: "直接上前质问，要求对方说清楚", type: "extreme" },
      { key: "F", label: "故作镇定地换个无厘头话题试探对方", type: "absurd" },
    );
  }
  if (!currentSituation) {
    currentSituation = `当前处于${defaultLoc}，周围似乎有些反常的动向。`;
  }

  return {
    narrative,
    currentSituation,
    suggestions,
    ...(hookItem ? { hookItem } : {}),
  };
}

export interface DecisionGateInput {
  dialogue: { addresseeName: string; npcReply: string } | null;
  interpretation: { contributions: string[]; outcome: string };
  envelope: { committed: string[]; uncommitted: string[] };
  text: string;
}

export function isMeaningfulDecisionNode(input: DecisionGateInput): boolean {
  // 1. Action barrier / Refusal / Hazard / Failure / Physical Obstacle
  if (
    input.envelope.uncommitted.length > 0 ||
    input.interpretation.outcome === "fail" ||
    input.interpretation.contributions.includes("refuse") ||
    (input.interpretation.contributions.includes("durable_attempt") && input.interpretation.outcome !== "candidate") ||
    /(受阻|锁死|打不开|纹丝未动|纹丝不动|无法进入|无法打开|被锁|撞不开)/.test(input.text)
  ) {
    return true;
  }
  // 2. Dialogue node: check if NPC speech represents a true decision fork vs mundane chitchat
  if (input.dialogue) {
    const text = input.dialogue.npcReply.trim();
    // Mundane chitchat filter
    const isMundane =
      /^(是啊|嗯|哦|好|好的|慢走|知道了|天气|随便看|欢迎光临|没什么|没事的|再见|我也觉得|挺好|行吧)[，。！\s]*$/.test(text) ||
      ((/(今天|明天|天气|挺凉快|凉快|挺热|吃饭|喝水|慢点走|早点回)/.test(text) || text.length < 15) &&
        !/(别走|别去|危险|小心|赶快|快点|失踪|警告|秘密|案|门|信|纸条|等等|\?|？|！|!)/.test(text));
    if (isMundane) {
      return false;
    }
    // Meaningful signals: requests, questions, warnings, anomalies, secrets, urgency
    const isMeaningful =
      /(别走|别去|小心|危险|赶快|快点|帮我|你在干什么|发生什么|你听说|你必须|不能|跟我来|交出|为什么|谁|告诉我|去哪|失踪|纸条|信|密码|凶手|警告|秘密|\?|？|！|!)/.test(
        text,
      );
    return isMeaningful;
  }
  return false;
}

export function evaluateDecisionGate(
  input: DecisionGateInput,
  activeSituation?: string | null,
): { suggestions?: import("../http/view.js").ActionSuggestion[]; currentSituation: string | null } {
  // If not a meaningful decision node, no suggestions! Active situation remains preserved!
  if (!isMeaningfulDecisionNode(input)) {
    return {
      currentSituation: activeSituation ?? null,
    };
  }

  // Case 1: NPC Dialogue Node
  if (input.dialogue) {
    const npc = input.dialogue.addresseeName;
    const replySnippet = input.dialogue.npcReply.replace(/\s+/g, " ").slice(0, 30);
    const suggestions: import("../http/view.js").ActionSuggestion[] = [
      { key: "A", label: `如实回应${npc}，说明自己的情况`, type: "constructive" },
      { key: "B", label: `反问${npc}，打听更多内情与细节`, type: "constructive" },
      { key: "C", label: `含糊应付过去，转移话题`, type: "constructive" },
      { key: "D", label: `不予理会，自顾自做自己的事`, type: "constructive" },
      { key: "E", label: `直接挑明疑点，严肃质问${npc}`, type: "extreme" },
      { key: "F", label: `一本正经地开个玩笑逗逗${npc}`, type: "absurd" },
    ];
    return {
      suggestions,
      currentSituation: `眼下：${npc}正在对你说：「${replySnippet}…」`,
    };
  }

  // Case 2: Action Refusal / Danger / Obstacle Node
  const reason = input.envelope.uncommitted[0] ?? "当前行动受阻或无法继续";
  const suggestions: import("../http/view.js").ActionSuggestion[] = [
    { key: "A", label: "另寻其他途径或替代方案", type: "constructive" },
    { key: "B", label: "退回安全位置，仔细观察周围动静", type: "constructive" },
    { key: "C", label: "向在场的人询问刚才的情况", type: "constructive" },
    { key: "D", label: "暂时放弃该意图，先处理日常事务", type: "constructive" },
    { key: "E", label: "不顾阻碍，强行再次尝试", type: "extreme" },
    { key: "F", label: "对着阻碍大声吐槽两句缓解气氛", type: "absurd" },
  ];
  return {
    suggestions,
    currentSituation: `眼下：你的行动受到阻碍（${reason}）。`,
  };
}

export function renderNarratorPrompt(envelope: NarratorEnvelope): string {
  const committed = envelope.committed.length > 0 ? envelope.committed.join("；") : "（本轮没有新的已提交后果）";
  const uncommitted = envelope.uncommitted.length > 0
    ? envelope.uncommitted.join("；")
    : "（本轮没有被拒绝的持久企图）";
  const npc = envelope.npcReply
    ? `${envelope.npcReply.name}已经说出口：「${envelope.npcReply.line}」`
    : "（没有合法 NPC 开口）";
  const ambient = envelope.ephemeral.ambient.join(" ") || "（无）";
  return [
    envelope.observerContext,
    `【玩家行动】${envelope.playerContribution || "（沉默）"}`,
    `【已发生】${committed}`,
    `【未发生】${uncommitted}`,
    `【NPC】${npc}`,
    `【氛围】${ambient}`,
  ].join("\n");
}
