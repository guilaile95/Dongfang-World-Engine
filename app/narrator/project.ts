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
  "Opening 是第一幕和风格样板：示范第二人称、信息密度、描写长度、NPC 对话味道和一次推进的尺度；遇到真正决定点才把行动权交还玩家。",
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
  characterization?: string;
  styleAnchors?: string[];
  recentHistory?: string[];
}

export function renderOpeningPrompt(input: OpeningPromptInput): string {
  const styleAnchors = input.styleAnchors ?? [
    "全程第二人称；每段都有新信息；只推进一个可感知变化。",
    "NPC 对话使用自然短句，不替 NPC 透露不可见秘密。",
    "出现真正决定点时，把行动权交还给玩家。",
  ];
  const recentHistory = input.recentHistory?.join("\n---\n") || "（无）";
  const parts: string[] = [
    "【世界/作品长期设定】" + input.worldTitle,
    "【当前时期 Scenario】" + input.era + "；" + input.timeLabel + "；" + input.publicPremise,
    "【当前角色 Characterization】" + ((input.characterization ?? input.profile.background) || "普通学生，保持普通人的知识边界。"),
    "【玩家 Persona】名字=" + (input.profile.name || "玩家") + "；年龄=" + (input.profile.age || "18") + "；性别=" + (input.profile.gender || "未知") + "；背景=" + (input.profile.background || "普通学生") + "；性格=" + (input.profile.personality || "务实"),
    "【Example Dialogue / Style Anchor】\n" + styleAnchors.map((line) => "- " + line).join("\n") + "\n- NPC 示例：「先别急，先看看眼前发生了什么。」",
    "【当前场景近端强化】地点=" + input.locationName + "；在场=" + (input.presentCharacters.join("、") || "（无）") + "；公共动静=" + (input.publicBeat || "（无）"),
    "【Visibility Gate 后合法的 World/Lore Context】\n已知规则=" + (input.publicRules.join("；") || "（无）") + "\n公开资料与传闻=" + (input.publicLore.join("\n") || "（无）"),
    "【Recent History】\n" + recentHistory,
  ];
  const p = input.profile;
  parts.push("【起始位置】" + (p.startingLocation || input.locationName));
  if (input.plannedHook) {
    parts.push(`【本局开场既定事件（必须遵从描写）】${input.plannedHook.narrativeDirective}`);
  }
  parts.push("【最终 Narration Instructions】请严格以第二人称「你」写出约250–450字的第一幕；示范可感知信息密度、NPC对话味道、一次推进的尺度；若出现真正决定点，用自然语言把行动权交还玩家，并给出 A–F 六个行动选项。");
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

export function renderNarratorPrompt(envelope: NarratorEnvelope): string {
  const committed = envelope.committed.length > 0 ? envelope.committed.join("；") : "（本轮没有新的已提交后果）";
  const uncommitted = envelope.uncommitted.length > 0
    ? envelope.uncommitted.join("；")
    : "（本轮没有被拒绝的持久企图）";
  const npc = envelope.npcReply
    ? `${envelope.npcReply.name}已经说出口：「${envelope.npcReply.line}」`
    : "（没有合法 NPC 开口）";
  const ambient = envelope.ephemeral.ambient.join(" ") || "（无）";
  const composition = envelope.promptComposition;
  const context = composition
    ? [
      "【世界/作品长期设定】" + composition.longTermSetting,
      "【当前时期 Scenario】" + composition.scenario,
      "【当前角色 Characterization】" + composition.characterization,
      "【玩家 Persona】" + composition.playerPersona,
      "【Example Dialogue / Style Anchor】\n" + composition.styleAnchors.map((line) => "- " + line).join("\n"),
      "【当前场景近端强化】" + (composition.sceneReinforcement || "（无）"),
      "【Visibility Gate 后合法的 World/Lore Context】\n" + composition.visibleWorld,
      "【Recent History】\n" + (composition.recentHistory.join("\n---\n") || "（无）"),
      "【当前玩家输入】" + (composition.currentInput || "（沉默）"),
      "【已提交后果】" + committed,
      "【未提交持久企图】" + uncommitted,
      "【NPC】" + npc,
      "【氛围】" + ambient,
    ].join("\n")
    : [
      envelope.observerContext,
      `【玩家行动】${envelope.playerContribution || "（沉默）"}`,
      `【已发生】${committed}`,
      `【未发生】${uncommitted}`,
      `【NPC】${npc}`,
      `【氛围】${ambient}`,
    ].join("\n");
  return [context, "【最终 Narration Instructions】只描述经过 Visibility Gate 的信息和已提交后果；未确认的持久后果不得写成已经发生；保持第二人称和自然对话，不输出内部结构或 schema。"].join("\n");
}
