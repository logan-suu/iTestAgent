import type { Clarification, Intent, IntentParseResult, Scope } from 'itestagent-contracts';
import type { ProjectProfile } from 'itestagent-project-analyzer';

/**
 * parseIntent — rule-based intent parser (Phase 2.5, no AI SDK dependency).
 *
 * Data flow (Data Flow Specification §4):
 *   NL input → keyword matching → Intent { goal, targetKind?, features, scope, … }
 *   If critical info missing → incomplete with clarificationsNeeded.
 *
 * AC1 (US-4.2): Supports multi-turn clarification via incomplete results.
 * Task 3.8 will replace with LLM-based parseIntentWithLLM().
 *
 * @param input   Raw user input from TUI (may contain whitespace noise).
 * @param profile Optional ProjectProfile for feature matching; without it, only scope/targetKind are extracted.
 */
export function parseIntent(input: string, profile?: ProjectProfile): IntentParseResult {
  const normalized = input.toLowerCase().trim();
  const sourceText = input;

  // ── 1. Extract targetKind ────────────────────────────────

  const targetKind = extractTargetKind(normalized);

  // ── 2. Extract scope ─────────────────────────────────────

  const scope = extractScope(normalized);

  // ── 3. Extract metrics request ───────────────────────────

  const metricsRequested = extractMetricsRequest(normalized, scope);

  // ── 4. Match features against profile ────────────────────

  const features = profile ? matchFeatures(normalized, profile) : [];

  // ── 5. Extract goal (de-noised summary) ──────────────────

  const goal = extractGoal(normalized, scope, features);

  // ── 6. Build intent ──────────────────────────────────────

  const intent: Intent = {
    goal,
    targetKind,
    features,
    metricsRequested,
    scope,
    sourceText,
  };

  // ── 7. Determine if incomplete ───────────────────────────

  // Empty/whitespace input is always incomplete
  if (normalized.length === 0) {
    return {
      status: 'incomplete',
      intent,
      clarificationsNeeded: [
        {
          question: '请描述你想做的测试，例如：帮我用本机 iPhone 跑一下登录 smoke',
          field: 'features',
        },
      ],
    };
  }

  const clarificationsNeeded = buildClarifications(intent, profile);

  if (clarificationsNeeded.length > 0) {
    return {
      status: 'incomplete',
      intent,
      clarificationsNeeded,
    };
  }

  return {
    status: 'complete',
    intent,
  };
}

// ─── Private helpers ──────────────────────────────────────────

const PHYSICAL_KEYWORDS = ['phone', '真机', '本机', 'iphone', 'ipad', 'device', '手机', '实机'];

const SIMULATOR_KEYWORDS = ['simulator', '模拟器', '模拟'];

function extractTargetKind(normalized: string): 'physical' | 'simulator' | undefined {
  for (const kw of SIMULATOR_KEYWORDS) {
    if (normalized.includes(kw)) return 'simulator';
  }
  for (const kw of PHYSICAL_KEYWORDS) {
    if (normalized.includes(kw)) return 'physical';
  }
  return undefined;
}

const SCOPE_PATTERNS: Array<{ scope: Scope; keywords: string[] }> = [
  { scope: 'explore', keywords: ['explore', '探索'] },
  { scope: 'perf', keywords: ['perf', 'performance', '性能', 'profile', 'profiling'] },
  { scope: 'full', keywords: ['full', 'regression', '回归', 'full regression', 'complete'] },
  { scope: 'smoke', keywords: ['smoke', '冒烟', '冒烟测试', 'core', '关键链路'] },
];

function extractScope(normalized: string): Scope {
  for (const { scope, keywords } of SCOPE_PATTERNS) {
    for (const kw of keywords) {
      if (normalized.includes(kw)) return scope;
    }
  }
  // If the input describes testing but no explicit scope → default explore
  if (normalized.includes('test') || normalized.includes('测试') || normalized.includes('跑')) {
    return 'explore';
  }
  return 'custom';
}

const METRICS_KEYWORDS = [
  '性能',
  'performance',
  'fps',
  'hitches',
  'hangs',
  'memory',
  'launch time',
  '启动',
  'profile',
  'profiling',
  'metric',
  'metrics',
];

function extractMetricsRequest(normalized: string, scope: Scope): boolean {
  // perf scope always implies metrics
  if (scope === 'perf') return true;
  return METRICS_KEYWORDS.some((kw) => normalized.includes(kw));
}

function matchFeatures(normalized: string, profile: ProjectProfile): string[] {
  const normalizedInput = normalized.toLowerCase();
  const matched: string[] = [];

  for (const feature of profile.features) {
    // Match by feature name (case-insensitive)
    if (normalizedInput.includes(feature.name.toLowerCase())) {
      matched.push(feature.name);
      continue;
    }

    // Match by profile keywords
    const keywords = feature.keywords ?? [];
    for (const kw of keywords) {
      if (normalizedInput.includes(kw.toLowerCase())) {
        matched.push(feature.name);
        break;
      }
    }

    // Match Chinese equivalents of profile keywords
    if (!matched.includes(feature.name)) {
      for (const kw of keywords) {
        const cnVariants = CN_KEYWORD_MAP[kw.toLowerCase()];
        if (cnVariants) {
          for (const cn of cnVariants) {
            if (normalizedInput.includes(cn)) {
              matched.push(feature.name);
              break;
            }
          }
        }
        if (matched.includes(feature.name)) break;
      }
    }
  }

  return matched;
}

const CN_KEYWORD_MAP: Record<string, string[]> = {
  login: ['登录', '登入'],
  signin: ['登录', '登入', '签到'],
  signup: ['注册', '註冊'],
  register: ['注册', '註冊'],
  payment: ['支付', '付款', '购买', '購買'],
  checkout: ['结算', '結算', '下单', '下單'],
  cart: ['购物车', '購物車'],
  order: ['订单', '訂單'],
  profile: ['个人资料', '個人資料', '资料', '資料'],
  account: ['账户', '賬戶', '账号', '帳號'],
  settings: ['设置', '設置', '設定'],
  preferences: ['偏好', '偏好设置', '偏好設置'],
  search: ['搜索', '搜尋'],
  discover: ['发现', '發現'],
  explore: ['探索', '浏览', '瀏覽'],
  chat: ['聊天', '消息'],
  message: ['消息', '訊息', '信息'],
  inbox: ['收件箱', '收件匣'],
  notification: ['通知', '提醒'],
  home: ['首页', '首頁', '主页', '主頁'],
  dashboard: ['仪表盘', '儀表板', '面板'],
  detail: ['详情', '詳情', '详细', '詳細'],
  feed: ['动态', '動態', '信息流'],
  timeline: ['时间线', '時間線'],
  photo: ['照片', '相片', '图片', '圖片'],
  video: ['视频', '影片'],
  camera: ['相机', '相機', '摄像头', '攝像頭'],
  gallery: ['相册', '相冊', '图库', '圖庫'],
  map: ['地图', '地圖'],
  location: ['位置', '定位'],
};

function extractGoal(normalized: string, scope: Scope, features: string[]): string {
  // Build a concise goal description from parsed components
  if (normalized.length === 0) return '';

  const parts: string[] = [];

  const scopeLabels: Record<Scope, string> = {
    smoke: 'smoke test',
    explore: 'exploration',
    full: 'full regression',
    perf: 'performance test',
    custom: 'custom test',
  };

  if (scope !== 'custom') {
    parts.push(scopeLabels[scope]);
  }

  if (features.length > 0) {
    parts.push(`features: ${features.join(', ')}`);
  }

  if (parts.length === 0) {
    return normalized.length > 80 ? normalized.slice(0, 80) : normalized;
  }

  return parts.join(' — ');
}

function buildClarifications(intent: Intent, profile?: ProjectProfile): Clarification[] {
  const clarifications: Clarification[] = [];

  // targetKind: required for smoke/full/perf, optional for explore/custom
  const REQUIRES_TARGET: Scope[] = ['smoke', 'full', 'perf'];
  if (!intent.targetKind && REQUIRES_TARGET.includes(intent.scope)) {
    clarifications.push({
      question: '你想在什么设备上测试？',
      field: 'targetKind',
      options: ['真机 (iPhone)', '模拟器 (Simulator)'],
    });
  }

  // features: only when profile is available and scope is smoke/full and no features matched
  const REQUIRES_FEATURES: Scope[] = ['smoke', 'full'];
  if (profile && intent.features.length === 0 && REQUIRES_FEATURES.includes(intent.scope)) {
    const candidateNames = profile.features.slice(0, 5).map((f) => f.name);
    if (candidateNames.length > 0) {
      clarifications.push({
        question: `你想测试哪些功能？已检测到以下候选项：${candidateNames.join('、')}`,
        field: 'features',
        options: candidateNames,
      });
    } else {
      clarifications.push({
        question: '你想测试哪些功能？(例如: login, settings, payment)',
        field: 'features',
      });
    }
  }

  return clarifications;
}
