#import <UIKit/UIKit.h>
#include <stdlib.h>
#include <string.h>

// Deliberately lose an allocation in positive mode; release the same allocation in control mode.
__attribute__((noinline)) static BOOL runAllocation(BOOL control) {
    unsigned char *volatile block = malloc(262144);
    if (!block) return NO;
    memset((void *)block, 0x5A, 262144);
    if (control) free((void *)block);
    block = NULL;
    return YES;
}

@interface MemoryProbeViewController : UIViewController
@property(strong, nonatomic) UILabel *label;
@property(strong, nonatomic) UILabel *statusLabel;
@property(strong, nonatomic) UIButton *leakButton;
@property(strong, nonatomic) UIButton *controlButton;
@property(assign, nonatomic) NSInteger allocations;
@property(assign, nonatomic) NSInteger batches;
@property(assign, nonatomic) BOOL control;
@property(assign, nonatomic) BOOL started;
@property(assign, nonatomic) BOOL running;
@property(assign, nonatomic) NSInteger completedRounds;
@end

@implementation MemoryProbeViewController
- (void)saveReceipt {
    NSDictionary *receipt = @{@"schemaVersion": @"itestagent.memory-control.v2",
      @"mode": self.control ? @"freed" : @"unreachable",
      @"allocations": @(self.allocations), @"bytesPerAllocation": @262144,
      @"batches": @(self.batches), @"freed": @(self.control ? self.allocations : 0),
      @"started": @(self.started), @"running": @(self.running),
      @"completedRounds": @(self.completedRounds), @"maximumRounds": @10, @"complete": @(self.batches == 4)};
    NSData *data = [NSJSONSerialization dataWithJSONObject:receipt options:0 error:nil];
    NSString *dir = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
    [data writeToFile:[dir stringByAppendingPathComponent:@"workload.json"] atomically:YES];
    self.label.text = [NSString stringWithFormat:@"Mode: %@\nBatches: %ld / 4\nAllocations: %ld\nMaximum workload per round: 5 MiB\nCompleted rounds: %ld / 10", self.started ? (self.control ? @"freed control" : @"known unreachable") : @"idle", (long)self.batches, (long)self.allocations, (long)self.completedRounds];
    self.statusLabel.text = self.batches == 4 ? @"Workload complete" : (self.started ? @"Workload running" : @"Ready for recording");
}
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    UILabel *title = [UILabel new];
    title.text = @"iTest Memory Probe";
    title.accessibilityIdentifier = @"memory-probe-title";
    title.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle1];
    self.label = [UILabel new];
    self.label.numberOfLines = 0;
    self.statusLabel = [UILabel new];
    self.statusLabel.accessibilityIdentifier = @"memory-probe-status";
    self.leakButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [self.leakButton setTitle:@"Run Leak Workload" forState:UIControlStateNormal];
    self.leakButton.accessibilityIdentifier = @"run-leak-workload";
    [self.leakButton addTarget:self action:@selector(startLeak) forControlEvents:UIControlEventTouchUpInside];
    self.controlButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [self.controlButton setTitle:@"Run Released Workload" forState:UIControlStateNormal];
    self.controlButton.accessibilityIdentifier = @"run-released-workload";
    [self.controlButton addTarget:self action:@selector(startControl) forControlEvents:UIControlEventTouchUpInside];
    UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[title, self.label, self.statusLabel, self.leakButton, self.controlButton]];
    stack.axis = UILayoutConstraintAxisVertical;
    stack.spacing = 24;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.leadingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.leadingAnchor constant:24],
      [stack.trailingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.trailingAnchor constant:-24],
      [stack.centerYAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.centerYAnchor]
    ]];
    [self saveReceipt];
}
- (void)startLeak { [self startWorkload:NO]; }
- (void)startControl { [self startWorkload:YES]; }
- (void)startWorkload:(BOOL)control {
    // Each explicit tap starts one bounded round; concurrent taps and mode switches are ignored.
    if (self.running || self.completedRounds >= 10 || (self.started && self.control != control)) return;
    self.running = YES;
    self.allocations = 0;
    self.batches = 0;
    self.started = YES;
    self.control = control;
    self.leakButton.enabled = NO;
    self.controlButton.enabled = NO;
    [self saveReceipt];
    for (NSInteger batch = 0; batch < 4; batch++) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, batch * 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            for (NSInteger i = 0; i < 5; i++) if (runAllocation(self.control)) self.allocations++;
            self.batches++;
            if (self.batches == 4) {
                self.running = NO;
                self.completedRounds++;
                self.leakButton.enabled = !self.control && self.completedRounds < 10;
                self.controlButton.enabled = self.control && self.completedRounds < 10;
            }
            [self saveReceipt];
        });
    }
}
@end

@interface ProbeDelegate : UIResponder <UIApplicationDelegate>
@property(strong, nonatomic) UIWindow *window;
@end

@implementation ProbeDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = [MemoryProbeViewController new];
    [self.window makeKeyAndVisible];
    return YES;
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(ProbeDelegate.class)); }
}
