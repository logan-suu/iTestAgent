import type {
  ActionResult,
  AppInfo,
  ArtifactRef,
  BackendCapabilities,
  CrashSummary,
  DeviceInfo,
  DeviceTarget,
  HealthCheckResult,
  LaunchAppInput,
  LogCollectInput,
  OpenUrlInput,
  PressButtonInput,
  RecordingHandle,
  RecordingInput,
  ScreenshotInput,
  SwipeInput,
  TapInput,
  TerminateAppInput,
  TypeTextInput,
  UiTreeSnapshot,
} from './device-types.js';

/**
 * DeviceBackend — 设备操作 Backend 接口（§5.1）
 *
 * 所有真机设备操作（Appium/WDA、mobile-mcp、iphone-use）均实现此接口。
 * 方法返回 Promise，Engine 侧统一编排，不直接拼底层命令。
 */
export interface DeviceBackend {
  /** Backend 实现名称（如 "Appium/WDA"、"mobile-mcp"） */
  readonly name: string;

  /** Backend 能力声明 */
  readonly capabilities: BackendCapabilities;

  /** 设备发现 */
  listDevices(): Promise<DeviceInfo[]>;

  /** 设备健康检查 */
  healthcheck(deviceId: string): Promise<HealthCheckResult>;

  /** 已安装 App 列表 */
  listApps(deviceId: string): Promise<AppInfo[]>;

  /** 启动 App */
  launchApp(input: LaunchAppInput): Promise<ActionResult>;

  /** 终止 App */
  terminateApp(input: TerminateAppInput): Promise<ActionResult>;

  /** 获取 UI 树（accessibility tree） */
  getUiTree(input: DeviceTarget): Promise<UiTreeSnapshot>;

  /** 截图 */
  screenshot(input: ScreenshotInput): Promise<ArtifactRef>;

  /** 点击（normalized coordinates 0-1） */
  tap(input: TapInput): Promise<ActionResult>;

  /** 滑动 */
  swipe(input: SwipeInput): Promise<ActionResult>;

  /** 输入文本 */
  typeText(input: TypeTextInput): Promise<ActionResult>;

  /** 按硬件按钮 */
  pressButton(input: PressButtonInput): Promise<ActionResult>;

  /** 打开 URL/Deep Link */
  openUrl(input: OpenUrlInput): Promise<ActionResult>;

  /** 开始录制（视频/截图） */
  startRecording(input: RecordingInput): Promise<RecordingHandle>;

  /** 停止录制 */
  stopRecording(input: RecordingHandle): Promise<ArtifactRef>;

  /** 崩溃日志列表 */
  listCrashes(input: DeviceTarget): Promise<CrashSummary[]>;

  /** 收集日志（syslog/crashlog） */
  collectLogs(input: LogCollectInput): Promise<ArtifactRef>;
}
