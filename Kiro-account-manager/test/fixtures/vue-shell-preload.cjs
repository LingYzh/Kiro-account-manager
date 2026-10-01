/* Electron preload test fixture uses CommonJS and callback factories. */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { contextBridge, ipcRenderer } = require('electron')

const listenerCounts = new Map()
const subscribe = (name) => (callback) => {
    const listener = (_event, ...args) => callback(...args)
    ipcRenderer.on(name, listener)
    listenerCounts.set(name, (listenerCounts.get(name) || 0) + 1)
    let subscribed = true
    return () => {
        ipcRenderer.removeListener(name, listener)
        if (subscribed) listenerCounts.set(name, listenerCounts.get(name) - 1)
        subscribed = false
    }
}
const send =
    (name) =>
    (...args) =>
        ipcRenderer.send(name, ...args)

const invoke =
    (name) =>
    (...args) =>
        ipcRenderer.invoke('mock-page-call', name, ...args)

const pageMethods = Object.fromEntries(
    [
        'machineIdGetOSType',
        'machineIdCheckAdmin',
        'machineIdGetCurrent',
        'machineIdGenerateRandom',
        'machineIdSet',
        'machineIdBackupToFile',
        'machineIdRestoreFromFile',
        'machineIdRequestAdminRestart',
        'proxyGetModels',
        'getKiroAvailableModels',
        'diagnoseRun',
        'diagnoseAccountLiveness',
        'getKiroSettings',
        'saveKiroSettings',
        'openKiroSettingsFile',
        'openKiroMcpConfig',
        'openKiroSteeringFolder',
        'openKiroSteeringFile',
        'createKiroDefaultRules',
        'readKiroSteeringFile',
        'saveKiroSteeringFile',
        'deleteKiroSteeringFile',
        'saveMcpServer',
        'deleteMcpServer',
        'kproxyInit',
        'kproxyGetStatus',
        'kproxyCheckCaCertInstalled',
        'kproxyUpdateConfig',
        'kproxySetDeviceId',
        'kproxyGenerateDeviceId',
        'kproxyStart',
        'kproxyStop',
        'kproxyInstallCaCert',
        'kproxyUninstallCaCert',
        'kproxyExportCaCert',
        'downloadUpdate',
        'installUpdate',
        'getShowWindowShortcut',
        'setShowWindowShortcut',
        'getUsageApiType',
        'setUsageApiType',
        'getUseKProxyForApi',
        'setUseKProxyForApi',
        'getTraySettings',
        'saveTraySettings',
        'importFromFile',
        'exportToFile',
        'setProactiveRenewalEnabled',
        'proxyPoolValidate',
        'proxyPoolDiagnoseChain',
        'accountSetProxyBinding',
        'proxyGetStatus',
        'proxyGetAccounts',
        'proxyUpdateConfig',
        'proxyStart',
        'proxyStop',
        'proxySyncAccounts',
        'proxyRefreshModels',
        'proxyLoadLogs',
        'proxySaveLogs',
        'proxyResetCredits',
        'proxyResetTokens',
        'proxyResetRequestStats',
        'proxyNeedsRestart',
        'proxySelfSignedCertInfo',
        'proxySelfSignedCertRegenerate',
        'proxyAuditLog',
        'proxyRestart',
        'proxyGetApiKeys',
        'proxyAddApiKey',
        'proxyUpdateApiKey',
        'proxyDeleteApiKey',
        'proxyResetApiKeyUsage',
        'proxyDesktopState',
        'proxyDesktopPreview',
        'proxyDesktopApply',
        'proxyDesktopRestore',
        'proxyConfigureClients',
        'accountSetOverage',
        'diagnoseHttpProbe',
        'registrationStatus',
        'registrationManualPhase1',
        'registrationManualPhase2',
        'registrationManualPhase3',
        'registrationStartAuto',
        'registrationCancel',
        'protonLoginStatus',
        'protonOpenLogin',
        'protonClose'
    ].map((name) => [name, invoke(name)])
)
const syntheticAccounts = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => {
        const id = `synthetic-${index}`
        return [
            id,
            {
                id,
                email: `offline-${index}@example.invalid`,
                nickname: `Synthetic ${index}`,
                idp: 'Google',
                credentials: {
                    accessToken: `synthetic-access-${index}`,
                    csrfToken: '',
                    refreshToken: 'synthetic-refresh',
                    expiresAt: Date.now() + 86400000,
                    authMethod: 'social',
                    provider: 'Google',
                    region: 'us-east-1'
                },
                subscription: { type: 'Free', title: 'KIRO FREE', daysRemaining: 30 },
                usage: { current: 10, limit: 100, percentUsed: 0.1, lastUpdated: Date.now() },
                tags: [],
                status: 'active',
                isActive: false,
                createdAt: Date.now(),
                lastUsedAt: Date.now()
            }
        ]
    })
)

contextBridge.exposeInMainWorld('api', {
    __testListenerCounts: () => Object.fromEntries(listenerCounts),
    ...pageMethods,
    getAppVersion: async () => '1.7.9',
    checkForUpdatesManual: invoke('checkForUpdatesManual'),
    openExternal: invoke('openExternal'),
    proxyGetLogs: invoke('proxyGetLogs'),
    proxyGetLogsCount: invoke('proxyGetLogsCount'),
    proxyClearLogs: invoke('proxyClearLogs'),
    loadAccounts: async () => ({
        accounts: syntheticAccounts,
        groups: {},
        tags: {},
        activeAccountId: null,
        autoRefreshEnabled: false,
        autoSwitchEnabled: false,
        proxyEnabled: false,
        darkMode: false,
        language: 'zh'
    }),
    saveAccounts: send('mock-save-accounts'),
    getProactiveRenewalEnabled: async () => ({ success: true, enabled: false }),
    getLocalActiveAccount: async () => ({ success: false }),
    loadKiroCredentials: invoke('loadKiroCredentials'),
    verifyAccountCredentials: invoke('verifyAccountCredentials'),
    accountGetModels: invoke('accountGetModels'),
    switchAccount: invoke('switchAccount'),
    switchAccountCli: invoke('switchAccountCli'),
    logoutAccount: invoke('logoutAccount'),
    proxyClearAccountSuspended: invoke('proxyClearAccountSuspended'),
    accountGetSubscriptions: invoke('accountGetSubscriptions'),
    accountGetSubscriptionUrl: invoke('accountGetSubscriptionUrl'),
    openSubscriptionWindow: invoke('openSubscriptionWindow'),
    startBuilderIdLogin: invoke('startBuilderIdLogin'),
    pollBuilderIdAuth: invoke('pollBuilderIdAuth'),
    cancelBuilderIdLogin: invoke('cancelBuilderIdLogin'),
    startIamSsoLogin: invoke('startIamSsoLogin'),
    pollIamSsoAuth: invoke('pollIamSsoAuth'),
    cancelIamSsoLogin: invoke('cancelIamSsoLogin'),
    startSocialLogin: invoke('startSocialLogin'),
    exchangeSocialToken: invoke('exchangeSocialToken'),
    cancelSocialLogin: invoke('cancelSocialLogin'),
    importFromSsoToken: invoke('importFromSsoToken'),
    updateTrayAccountList: send('mock-tray-list'),
    updateTrayAccount: send('mock-tray-account'),
    updateTrayLanguage: send('mock-tray-language'),
    backgroundBatchRefresh: async () => ({}),
    backgroundBatchCheck: async () => ({}),
    refreshAccountToken: async () => ({ success: false }),
    setProxy: async () => ({ success: true }),
    onKiroIdeTokenChanged: subscribe('mock-ide'),
    onProxyWebhookTrigger: subscribe('mock-webhook'),
    onTrayRefreshAccount: subscribe('mock-tray-refresh'),
    onTraySwitchAccount: subscribe('mock-tray-switch'),
    onBackgroundRefreshResult: subscribe('mock-background-refresh'),
    onBackgroundCheckResult: subscribe('mock-background-check'),
    onProxyAccountSuspended: subscribe('mock-suspended'),
    onProxyAccountUpdate: subscribe('mock-account-update'),
    onProxyRequest: subscribe('mock-proxy-request'),
    onProxyResponse: subscribe('mock-proxy-response'),
    onProxyError: subscribe('mock-proxy-error'),
    onProxyStatusChange: subscribe('mock-proxy-status'),
    onRegistrationLog: subscribe('mock-registration-log'),
    onRegistrationStep: subscribe('mock-registration-step'),
    onRegistrationComplete: subscribe('mock-registration-complete'),
    onKproxyRequest: subscribe('mock-kproxy-request'),
    onKproxyStatusChange: subscribe('mock-kproxy-status'),
    onKproxyError: subscribe('mock-kproxy-error'),
    onUpdateChecking: subscribe('mock-update-checking'),
    onUpdateAvailable: subscribe('mock-update-available'),
    onUpdateNotAvailable: subscribe('mock-update-not-available'),
    onUpdateDownloadProgress: subscribe('mock-update-progress'),
    onUpdateDownloaded: subscribe('mock-update-downloaded'),
    onUpdateError: subscribe('mock-update-error'),
    onSocialAuthCallback: subscribe('mock-social-auth-callback'),
    onShowCloseConfirmDialog: subscribe('mock-close-confirm'),
    sendCloseConfirmResponse: send('mock-close-response'),
    window: {
        getPlatform: async () => 'win32',
        isMaximized: async () => false,
        onMaximizeChange: subscribe('mock-maximize-change'),
        minimize: send('mock-window-minimize'),
        maximizeToggle: send('mock-window-maximize'),
        close: send('mock-window-close')
    }
})
