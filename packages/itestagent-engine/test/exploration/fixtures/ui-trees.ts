/**
 * Test fixtures: UI tree XML snapshots for element locator and explorer tests.
 *
 * These simulate real Appium/WDA page source output (XCUIElementType* XML)
 * for various app screens used in exploration testing.
 */

import type { UiTreeSnapshot } from 'itestagent-contracts';

// ─── Login Screen ───────────────────────────────────────────────

export function loginScreenUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="Login" label="Login" enabled="true" visible="true" x="0" y="44" width="390" height="44"/>
    <XCUIElementTypeOther type="XCUIElementTypeOther" name="login_form" enabled="true" visible="true" x="0" y="88" width="390" height="756">
      <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="username_field" label="Username" enabled="true" visible="true" x="20" y="140" width="350" height="44"/>
      <XCUIElementTypeSecureTextField type="XCUIElementTypeSecureTextField" name="password_field" label="Password" enabled="true" visible="true" x="20" y="200" width="350" height="44"/>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="login_button" label="Login" enabled="true" visible="true" x="20" y="280" width="350" height="50"/>
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="forgot_password" label="Forgot Password?" enabled="true" visible="true" x="20" y="350" width="350" height="20"/>
    </XCUIElementTypeOther>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Settings Screen (table-based) ──────────────────────────────

export function settingsScreenUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Settings" label="Settings" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="Settings" label="Settings" enabled="true" visible="true" x="0" y="44" width="390" height="44"/>
    <XCUIElementTypeTable type="XCUIElementTypeTable" enabled="true" visible="true" x="0" y="88" width="390" height="756">
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="general_cell" label="General" enabled="true" visible="true" x="0" y="88" width="390" height="44"/>
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="display_cell" label="Display &amp; Brightness" enabled="true" visible="true" x="0" y="132" width="390" height="44"/>
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="privacy_cell" label="Privacy &amp; Security" enabled="true" visible="true" x="0" y="176" width="390" height="44"/>
    </XCUIElementTypeTable>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Permission Alert (Allow / Don't Allow) ─────────────────────

export function permissionAlertUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeAlert type="XCUIElementTypeAlert" name="permission_alert" label="&quot;MyApp&quot; Would Like to Access Your Photos" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" enabled="true" visible="true" x="0" y="0" width="390" height="844">
        <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="alert_message" label="This allows the app to access your photo library." enabled="true" visible="true" x="20" y="200" width="350" height="100"/>
        <XCUIElementTypeCollectionView type="XCUIElementTypeCollectionView" enabled="true" visible="true" x="0" y="400" width="390" height="100">
          <XCUIElementTypeCell type="XCUIElementTypeCell" name="allow_button" label="Allow" enabled="true" visible="true" x="20" y="420" width="165" height="44"/>
          <XCUIElementTypeCell type="XCUIElementTypeCell" name="deny_button" label="Don&apos;t Allow" enabled="true" visible="true" x="205" y="420" width="165" height="44"/>
        </XCUIElementTypeCollectionView>
      </XCUIElementTypeScrollView>
    </XCUIElementTypeAlert>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Simple OK Alert ────────────────────────────────────────────

export function okAlertUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeAlert type="XCUIElementTypeAlert" name="ok_alert" label="Error" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" enabled="true" visible="true" x="0" y="0" width="390" height="844">
        <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="alert_message" label="An error occurred. Please try again." enabled="true" visible="true" x="20" y="200" width="350" height="100"/>
        <XCUIElementTypeButton type="XCUIElementTypeButton" name="ok_button" label="OK" enabled="true" visible="true" x="20" y="420" width="350" height="44"/>
      </XCUIElementTypeScrollView>
    </XCUIElementTypeAlert>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Empty Screen ───────────────────────────────────────────────

export function emptyScreenUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="Empty" label="Empty Screen" enabled="true" visible="true" x="0" y="44" width="390" height="44"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="empty_label" label="No content" enabled="true" visible="true" x="20" y="200" width="350" height="20"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Duplicate Labels Screen ────────────────────────────────────

export function duplicateLabelsUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="Settings" label="Settings" enabled="true" visible="true" x="0" y="44" width="390" height="44"/>
    <XCUIElementTypeTable type="XCUIElementTypeTable" enabled="true" visible="true" x="0" y="88" width="390" height="756">
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="item1" label="Delete" enabled="true" visible="true" x="0" y="88" width="390" height="44"/>
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="item2" label="Delete" enabled="true" visible="true" x="0" y="132" width="390" height="44"/>
      <XCUIElementTypeCell type="XCUIElementTypeCell" name="item3" label="Delete" enabled="true" visible="true" x="0" y="176" width="390" height="44"/>
    </XCUIElementTypeTable>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Chinese Localized Alert ────────────────────────────────────

export function chineseAlertUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeAlert type="XCUIElementTypeAlert" name="cn_alert" label="&quot;MyApp&quot; 想访问您的相册" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" enabled="true" visible="true" x="0" y="0" width="390" height="844">
        <XCUIElementTypeCollectionView type="XCUIElementTypeCollectionView" enabled="true" visible="true" x="0" y="400" width="390" height="100">
          <XCUIElementTypeCell type="XCUIElementTypeCell" name="allow_btn" label="允许" enabled="true" visible="true" x="20" y="420" width="165" height="44"/>
          <XCUIElementTypeCell type="XCUIElementTypeCell" name="deny_btn" label="不允许" enabled="true" visible="true" x="205" y="420" width="165" height="44"/>
        </XCUIElementTypeCollectionView>
      </XCUIElementTypeScrollView>
    </XCUIElementTypeAlert>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Target Not Found Screen ────────────────────────────────────

export function targetNotFoundUiTree(): UiTreeSnapshot {
  return {
    raw: `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" name="Home" label="Home" enabled="true" visible="true" x="0" y="44" width="390" height="44"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="welcome" label="Welcome back!" enabled="true" visible="true" x="20" y="200" width="350" height="20"/>
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="settings_btn" label="Settings" enabled="true" visible="true" x="20" y="300" width="350" height="50"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`,
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
}
