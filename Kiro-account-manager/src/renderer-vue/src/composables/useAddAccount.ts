import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { Account, IdpType, SubscriptionType } from '@shared/types/account'
import { useAccountsStore } from '../stores/accounts'
import { useSettingsStore } from '../stores/settings'
import { toIpcData } from '../lib/ipcData'
import {
    parseCredentialInput,
    restoreFailedCredentials,
    type ImportCredential
} from '../lib/accountImport'

type LoginType = 'builderid' | 'google' | 'github' | 'iamsso'
type ImportMode = 'login' | 'oidc' | 'sso'
type AccountPayload = Omit<Account, 'id' | 'createdAt' | 'isActive'>
type VerifiedData = NonNullable<
    Awaited<ReturnType<typeof window.api.verifyAccountCredentials>>['data']
> & {
    profileArn?: string
    subscription?: {
        rawType?: string
        managementTarget?: string
        upgradeCapability?: string
        overageCapability?: string
    }
    usage: Account['usage']
}
type SsoData = NonNullable<Awaited<ReturnType<typeof window.api.importFromSsoToken>>['data']> & {
    subscriptionType?: string
    subscriptionTitle?: string
    daysRemaining?: number
    subscription?: VerifiedData['subscription']
    usage?: Account['usage']
}
type LoginToken = {
    refreshToken: string
    clientId?: string
    clientSecret?: string
    region?: string
    startUrl?: string
    authMethod?: 'IdC' | 'social'
    provider?: string
}
type ImportResult = { total: number; success: number; failed: number; errors: string[] }

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useAddAccount(open: Ref<boolean>, close: () => void, isEn: Ref<boolean>) {
    const accountsStore = useAccountsStore()
    const settingsStore = useSettingsStore()
    const importMode = ref<ImportMode>('login')
    const selectedGroupId = ref<string | undefined>()
    const refreshToken = ref('')
    const clientId = ref('')
    const clientSecret = ref('')
    const region = ref('us-east-1')
    const authMethod = ref<'IdC' | 'social'>('IdC')
    const provider = ref('BuilderId')
    const ssoToken = ref('')
    const oidcImportMode = ref<'single' | 'batch'>('single')
    const oidcBatchData = ref('')
    const ssoResult = ref<ImportResult | null>(null)
    const oidcResult = ref<ImportResult | null>(null)
    const error = ref('')
    const isVerifying = ref(false)
    const isSubmitting = ref(false)
    const importingLocal = ref(false)
    const loginType = ref<LoginType>('builderid')
    const isLoggingIn = ref(false)
    const usePrivateMode = ref(settingsStore.loginPrivateMode)
    const builderIdLoginData = ref<{
        userCode: string
        verificationUri: string
        expiresIn: number
        interval: number
    } | null>(null)
    const iamSsoLoginData = ref<{ verificationUri: string; expiresIn: number } | null>(null)
    const ssoStartUrl = ref('')
    const copied = ref(false)
    let generation = 0
    let mounted = true
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let copyTimer: ReturnType<typeof setTimeout> | undefined
    let socialUnsubscribe: (() => void) | undefined
    let activeFlow: LoginType | undefined
    let startPending = false
    let pendingCancellations = 0
    let pollPending = false
    let exchangePending = false
    let socialState: string | undefined

    function current(token: number): boolean {
        return mounted && open.value && token === generation
    }

    function message(cause: unknown): string {
        return cause instanceof Error ? cause.message : String(cause)
    }

    function stopLocalFlow(): LoginType | undefined {
        generation += 1
        if (pollTimer) clearTimeout(pollTimer)
        if (copyTimer) clearTimeout(copyTimer)
        pollTimer = undefined
        copyTimer = undefined
        socialUnsubscribe?.()
        socialUnsubscribe = undefined
        pollPending = false
        exchangePending = false
        socialState = undefined
        const flow = activeFlow
        activeFlow = undefined
        isLoggingIn.value = false
        isVerifying.value = false
        isSubmitting.value = false
        importingLocal.value = false
        builderIdLoginData.value = null
        iamSsoLoginData.value = null
        copied.value = false
        return flow
    }

    function cancelRemote(flow: LoginType | undefined): void {
        if (!flow) return
        const action =
            flow === 'builderid'
                ? window.api.cancelBuilderIdLogin
                : flow === 'iamsso'
                  ? window.api.cancelIamSsoLogin
                  : window.api.cancelSocialLogin
        pendingCancellations += 1
        void action()
            .catch(() => undefined)
            .finally(() => {
                pendingCancellations -= 1
            })
    }

    function cancelLogin(): void {
        const flow = stopLocalFlow()
        cancelRemote(flow)
        error.value = ''
    }

    function requestClose(): void {
        const flow = stopLocalFlow()
        cancelRemote(flow)
        close()
    }

    watch(
        open,
        (value) => {
            if (value) {
                const tab = accountsStore.activeGroupTab
                selectedGroupId.value =
                    tab !== 'all' && tab !== 'ungrouped' && accountsStore.groups.has(tab)
                        ? tab
                        : undefined
                usePrivateMode.value = settingsStore.loginPrivateMode
            } else {
                const flow = stopLocalFlow()
                cancelRemote(flow)
            }
        },
        { immediate: true }
    )

    onBeforeUnmount(() => {
        mounted = false
        const flow = stopLocalFlow()
        cancelRemote(flow)
    })

    function exists(
        email: string | undefined,
        userId: string | undefined,
        source: string
    ): boolean {
        return Array.from(accountsStore.accounts.values()).some((account) =>
            Boolean(
                (userId && account.userId === userId) ||
                (email && account.email === email && account.credentials.provider === source)
            )
        )
    }

    function usage(data: VerifiedData, now: number): Account['usage'] {
        return {
            current: data.usage.current,
            limit: data.usage.limit,
            percentUsed: data.usage.limit > 0 ? data.usage.current / data.usage.limit : 0,
            lastUpdated: now,
            baseLimit: data.usage.baseLimit,
            baseCurrent: data.usage.baseCurrent,
            freeTrialLimit: data.usage.freeTrialLimit,
            freeTrialCurrent: data.usage.freeTrialCurrent,
            freeTrialExpiry: data.usage.freeTrialExpiry,
            bonuses: data.usage.bonuses,
            nextResetDate: data.usage.nextResetDate,
            resourceDetail: data.usage.resourceDetail
        }
    }

    function verifiedPayload(
        data: VerifiedData,
        token: LoginToken,
        source: 'login' | 'single' | 'batch',
        password?: string
    ): AccountPayload {
        const now = Date.now()
        const sourceProvider = token.provider || 'BuilderId'
        const idp =
            source === 'batch' &&
            !['BuilderId', 'Enterprise', 'Github', 'Google'].includes(sourceProvider)
                ? 'BuilderId'
                : sourceProvider
        const credentials: Account['credentials'] = {
            accessToken: data.accessToken,
            csrfToken: '',
            refreshToken: data.refreshToken,
            clientId: token.clientId || '',
            clientSecret: token.clientSecret || '',
            region: token.region || 'us-east-1',
            expiresAt: data.expiresIn ? now + data.expiresIn * 1000 : now + 3600 * 1000,
            authMethod: token.authMethod,
            provider: sourceProvider as Account['credentials']['provider']
        }
        if (source === 'login') {
            credentials.startUrl = token.startUrl
            credentials.profileArn = data.profileArn
        } else if (source === 'batch') {
            credentials.profileArn = data.profileArn
        }
        const subscription: Account['subscription'] = {
            type: data.subscriptionType as SubscriptionType,
            title: data.subscriptionTitle,
            daysRemaining: data.daysRemaining,
            expiresAt: data.expiresAt,
            managementTarget: data.subscription?.managementTarget,
            upgradeCapability: data.subscription?.upgradeCapability,
            overageCapability: data.subscription?.overageCapability
        }
        if (source === 'login') subscription.rawType = data.subscription?.rawType
        return {
            email: data.email,
            userId: data.userId,
            ...(source === 'batch' ? { password } : {}),
            nickname: data.email ? data.email.split('@')[0] : undefined,
            idp: idp as IdpType,
            groupId: selectedGroupId.value,
            credentials,
            subscription,
            usage: usage(data, now),
            tags: [],
            status: 'active',
            lastUsedAt: now
        }
    }

    function addVerified(
        data: VerifiedData,
        token: LoginToken,
        source: 'login' | 'single' | 'batch',
        password?: string
    ): boolean {
        if (exists(data.email, data.userId, token.provider || 'BuilderId')) return false
        accountsStore.addAccount(verifiedPayload(data, token, source, password))
        return true
    }

    function resetAfterSuccess(): void {
        importMode.value = 'login'
        refreshToken.value = ''
        clientId.value = ''
        clientSecret.value = ''
        region.value = 'us-east-1'
        authMethod.value = 'IdC'
        provider.value = 'BuilderId'
        ssoToken.value = ''
        error.value = ''
        loginType.value = 'builderid'
        requestClose()
    }

    async function verifyAndAdd(
        token: LoginToken,
        source: 'login' | 'single',
        session: number
    ): Promise<void> {
        try {
            const result = await window.api.verifyAccountCredentials(
                toIpcData({
                    refreshToken: token.refreshToken,
                    clientId: token.clientId || '',
                    clientSecret: token.clientSecret || '',
                    region: token.region || 'us-east-1',
                    authMethod: token.authMethod,
                    provider: token.provider
                })
            )
            if (!current(session)) return
            if (!result.success || !result.data) {
                error.value = result.error || (isEn.value ? 'Verification failed' : '验证失败')
                return
            }
            if (!addVerified(result.data as VerifiedData, token, source)) {
                error.value = isEn.value
                    ? 'This account already exists'
                    : '该账号已存在，无需重复添加'
                return
            }
            resetAfterSuccess()
        } catch (cause) {
            if (current(session)) error.value = message(cause)
        }
    }

    function schedulePoll(flow: 'builderid' | 'iamsso', seconds: number, session: number): void {
        if (!current(session) || activeFlow !== flow) return
        pollTimer = setTimeout(
            async () => {
                pollTimer = undefined
                if (!current(session) || activeFlow !== flow || pollPending) return
                pollPending = true
                try {
                    const result =
                        flow === 'builderid'
                            ? await window.api.pollBuilderIdAuth(toIpcData(region.value))
                            : await window.api.pollIamSsoAuth(toIpcData(region.value))
                    if (!current(session) || activeFlow !== flow) return
                    if (!result.success) {
                        error.value =
                            result.error || (isEn.value ? 'Authorization failed' : '授权失败')
                        stopLocalFlow()
                        return
                    }
                    if (result.completed && result.refreshToken) {
                        await verifyAndAdd(
                            {
                                refreshToken: result.refreshToken,
                                clientId: result.clientId,
                                clientSecret: result.clientSecret,
                                region: result.region,
                                startUrl: flow === 'iamsso' ? ssoStartUrl.value.trim() : undefined,
                                authMethod: 'IdC',
                                provider: flow === 'iamsso' ? 'Enterprise' : 'BuilderId'
                            },
                            'login',
                            session
                        )
                        if (current(session)) stopLocalFlow()
                        return
                    }
                } catch (cause) {
                    if (current(session)) error.value = message(cause)
                } finally {
                    pollPending = false
                    if (current(session) && activeFlow === flow)
                        schedulePoll(flow, seconds, session)
                }
            },
            Math.max(1, seconds) * 1000
        )
    }

    async function startBuilderId(): Promise<void> {
        if (
            isLoggingIn.value ||
            startPending ||
            pendingCancellations ||
            importingLocal.value ||
            isSubmitting.value ||
            isVerifying.value
        )
            return
        error.value = ''
        isLoggingIn.value = true
        activeFlow = 'builderid'
        startPending = true
        const session = generation
        try {
            const result = await window.api.startBuilderIdLogin(toIpcData(region.value))
            if (!current(session) || activeFlow !== 'builderid') {
                if (result.success) cancelRemote('builderid')
                return
            }
            if (!result.success || !result.userCode || !result.verificationUri) {
                error.value =
                    result.error || (isEn.value ? 'Could not start login' : '启动登录失败')
                stopLocalFlow()
                return
            }
            builderIdLoginData.value = {
                userCode: result.userCode,
                verificationUri: result.verificationUri,
                expiresIn: result.expiresIn || 600,
                interval: result.interval || 5
            }
            void Promise.resolve(
                window.api.openExternal(result.verificationUri, usePrivateMode.value)
            ).catch((cause) => {
                if (current(session)) error.value = message(cause)
            })
            schedulePoll('builderid', result.interval || 5, session)
        } catch (cause) {
            if (current(session)) {
                error.value = message(cause)
                stopLocalFlow()
            }
        } finally {
            startPending = false
        }
    }

    async function startIamSso(): Promise<void> {
        if (
            isLoggingIn.value ||
            startPending ||
            pendingCancellations ||
            importingLocal.value ||
            isSubmitting.value ||
            isVerifying.value
        )
            return
        if (!ssoStartUrl.value.trim()) {
            error.value = isEn.value ? 'Enter SSO Start URL' : '请输入 SSO Start URL'
            return
        }
        error.value = ''
        isLoggingIn.value = true
        activeFlow = 'iamsso'
        startPending = true
        const session = generation
        try {
            const result = await window.api.startIamSsoLogin(
                toIpcData(ssoStartUrl.value.trim()),
                toIpcData(region.value)
            )
            if (!current(session) || activeFlow !== 'iamsso') {
                if (result.success) cancelRemote('iamsso')
                return
            }
            if (!result.success || !result.authorizeUrl) {
                error.value =
                    result.error || (isEn.value ? 'Could not start login' : '启动登录失败')
                stopLocalFlow()
                return
            }
            iamSsoLoginData.value = {
                verificationUri: result.authorizeUrl,
                expiresIn: result.expiresIn || 600
            }
            void Promise.resolve(
                window.api.openExternal(result.authorizeUrl, usePrivateMode.value)
            ).catch((cause) => {
                if (current(session)) error.value = message(cause)
            })
            schedulePoll('iamsso', 3, session)
        } catch (cause) {
            if (current(session)) {
                error.value = message(cause)
                stopLocalFlow()
            }
        } finally {
            startPending = false
        }
    }

    async function startSocial(kind: 'Google' | 'Github'): Promise<void> {
        if (
            isLoggingIn.value ||
            startPending ||
            pendingCancellations ||
            importingLocal.value ||
            isSubmitting.value ||
            isVerifying.value
        )
            return
        error.value = ''
        isLoggingIn.value = true
        activeFlow = kind === 'Google' ? 'google' : 'github'
        startPending = true
        const session = generation
        socialUnsubscribe = window.api.onSocialAuthCallback(async (data) => {
            if (!current(session) || !isLoggingIn.value || exchangePending || !data) return
            if (data.error) {
                error.value = data.error
                stopLocalFlow()
                return
            }
            if (!data.code || !data.state || !socialState || data.state !== socialState) return
            exchangePending = true
            try {
                const result = await window.api.exchangeSocialToken(
                    toIpcData(data.code),
                    toIpcData(data.state)
                )
                if (!current(session)) return
                if (!result.success || !result.refreshToken) {
                    error.value =
                        result.error || (isEn.value ? 'Token exchange failed' : 'Token 交换失败')
                    return
                }
                await verifyAndAdd(
                    {
                        refreshToken: result.refreshToken,
                        authMethod: 'social',
                        provider: result.provider || kind
                    },
                    'login',
                    session
                )
            } catch (cause) {
                if (current(session)) error.value = message(cause)
            } finally {
                exchangePending = false
                if (current(session)) stopLocalFlow()
            }
        })
        try {
            const result = await window.api.startSocialLogin(kind, usePrivateMode.value)
            if (!current(session) || !activeFlow) {
                if (result.success) cancelRemote(kind === 'Google' ? 'google' : 'github')
                return
            }
            if (!result.success) {
                error.value =
                    result.error || (isEn.value ? 'Could not start login' : '启动登录失败')
                stopLocalFlow()
            } else {
                socialState = result.state
            }
        } catch (cause) {
            if (current(session)) {
                error.value = message(cause)
                stopLocalFlow()
            }
        } finally {
            startPending = false
        }
    }

    async function copyUserCode(): Promise<void> {
        const code = builderIdLoginData.value?.userCode
        if (!code) return
        const session = generation
        try {
            await navigator.clipboard.writeText(code)
            if (!current(session)) return
            copied.value = true
            if (copyTimer) clearTimeout(copyTimer)
            copyTimer = setTimeout(() => {
                if (current(session)) copied.value = false
            }, 2000)
        } catch (cause) {
            if (current(session)) error.value = message(cause)
        }
    }

    async function importLocal(): Promise<void> {
        if (importingLocal.value || isSubmitting.value || isVerifying.value || isLoggingIn.value)
            return
        importingLocal.value = true
        const session = generation
        try {
            const result = await window.api.loadKiroCredentials()
            if (!current(session)) return
            if (!result.success || !result.data) {
                error.value = result.error || (isEn.value ? 'Import failed' : '导入失败')
                return
            }
            refreshToken.value = result.data.refreshToken
            clientId.value = result.data.clientId
            clientSecret.value = result.data.clientSecret
            region.value = result.data.region
            authMethod.value = result.data.authMethod === 'social' ? 'social' : 'IdC'
            provider.value = result.data.provider || 'BuilderId'
            error.value = ''
        } catch (cause) {
            if (current(session)) error.value = message(cause)
        } finally {
            if (current(session)) importingLocal.value = false
        }
    }

    async function addSingleOidc(): Promise<void> {
        if (isSubmitting.value || importingLocal.value || isVerifying.value || isLoggingIn.value)
            return
        if (!refreshToken.value) {
            error.value = isEn.value ? 'Enter Refresh Token' : '请填写 Refresh Token'
            return
        }
        if (authMethod.value !== 'social' && (!clientId.value || !clientSecret.value)) {
            error.value = isEn.value
                ? 'Enter Client ID and Client Secret'
                : '请填写 Client ID 和 Client Secret'
            return
        }
        isSubmitting.value = true
        error.value = ''
        const session = generation
        await verifyAndAdd(
            {
                refreshToken: refreshToken.value,
                clientId: clientId.value,
                clientSecret: clientSecret.value,
                region: region.value,
                authMethod: authMethod.value,
                provider: provider.value
            },
            'single',
            session
        )
        if (current(session)) isSubmitting.value = false
    }

    async function batchSso(): Promise<void> {
        if (isVerifying.value || importingLocal.value || isSubmitting.value || isLoggingIn.value)
            return
        const tokens = ssoToken.value
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean)
        if (!tokens.length) {
            error.value = isEn.value ? 'Enter at least one Token' : '请输入至少一个 Token'
            return
        }
        isVerifying.value = true
        error.value = ''
        ssoResult.value = null
        const session = generation
        const result: ImportResult = { total: tokens.length, success: 0, failed: 0, errors: [] }
        const failedIndices: number[] = []
        const process = async (raw: string, index: number): Promise<void> => {
            try {
                const response = await window.api.importFromSsoToken(
                    toIpcData(raw),
                    toIpcData(region.value)
                )
                if (!current(session)) return
                if (!response.success || !response.data) {
                    result.failed += 1
                    failedIndices.push(index)
                    result.errors.push(`#${index + 1}: ${response.error?.message || '导入失败'}`)
                    return
                }
                const data = response.data as SsoData
                if (data.email && data.userId && exists(data.email, data.userId, 'BuilderId')) {
                    result.errors.push(
                        `#${index + 1}: ${data.email} ${isEn.value ? 'already exists' : '已存在'}`
                    )
                    return
                }
                const now = Date.now()
                const sourceUsage = data.usage
                accountsStore.addAccount({
                    email: data.email || '',
                    userId: data.userId || '',
                    nickname: data.email ? data.email.split('@')[0] : undefined,
                    idp: 'BuilderId',
                    groupId: selectedGroupId.value,
                    credentials: {
                        accessToken: data.accessToken,
                        csrfToken: '',
                        refreshToken: data.refreshToken,
                        clientId: data.clientId,
                        clientSecret: data.clientSecret,
                        region: data.region,
                        expiresAt: data.expiresIn ? now + data.expiresIn * 1000 : now + 3600 * 1000
                    },
                    subscription: {
                        type: (data.subscriptionType || 'Free') as SubscriptionType,
                        title: data.subscriptionTitle || 'KIRO',
                        daysRemaining: data.daysRemaining,
                        managementTarget: data.subscription?.managementTarget,
                        upgradeCapability: data.subscription?.upgradeCapability,
                        overageCapability: data.subscription?.overageCapability
                    },
                    usage: {
                        current: sourceUsage?.current || 0,
                        limit: sourceUsage?.limit || 0,
                        percentUsed:
                            (sourceUsage?.limit || 0) > 0
                                ? (sourceUsage?.current || 0) / (sourceUsage?.limit || 1)
                                : 0,
                        lastUpdated: now,
                        baseLimit: sourceUsage?.baseLimit,
                        baseCurrent: sourceUsage?.baseCurrent,
                        freeTrialLimit: sourceUsage?.freeTrialLimit,
                        freeTrialCurrent: sourceUsage?.freeTrialCurrent,
                        freeTrialExpiry: sourceUsage?.freeTrialExpiry,
                        bonuses: sourceUsage?.bonuses,
                        nextResetDate: sourceUsage?.nextResetDate,
                        resourceDetail: sourceUsage?.resourceDetail
                    },
                    tags: [],
                    status: 'active',
                    lastUsedAt: now
                })
                result.success += 1
            } catch (cause) {
                if (!current(session)) return
                result.failed += 1
                failedIndices.push(index)
                result.errors.push(`#${index + 1}: ${message(cause)}`)
            }
        }
        const size = Math.max(1, settingsStore.batchImportConcurrency)
        for (let index = 0; index < tokens.length && current(session); index += size) {
            await Promise.allSettled(
                tokens
                    .slice(index, index + size)
                    .map((token, offset) => process(token, index + offset))
            )
            if (index + size < tokens.length && current(session))
                await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!current(session)) return
        ssoResult.value = result
        isVerifying.value = false
        if (result.failed === 0) resetAfterSuccess()
        else {
            ssoToken.value = failedIndices.map((index) => tokens[index]).join('\n')
            error.value = `成功导入 ${result.success} 个，失败 ${result.failed} 个`
        }
    }

    async function batchOidc(): Promise<void> {
        if (isSubmitting.value || importingLocal.value || isVerifying.value || isLoggingIn.value)
            return
        const parsed = parseCredentialInput(oidcBatchData.value)
        const credentials = parsed.credentials
        if (!credentials.length) {
            error.value = isEn.value ? 'Invalid format' : '格式错误，请输入 JSON 数组或卡密格式'
            return
        }
        isSubmitting.value = true
        error.value = ''
        oidcResult.value = null
        const session = generation
        const result: ImportResult = {
            total: credentials.length,
            success: 0,
            failed: 0,
            errors: []
        }
        const failedIndices: number[] = []
        const process = async (credential: ImportCredential, index: number): Promise<void> => {
            if (!credential.refreshToken) {
                result.failed += 1
                failedIndices.push(index)
                result.errors.push(`#${index + 1}: 缺少 refreshToken`)
                return
            }
            const source = credential.provider || 'BuilderId'
            const method =
                credential.authMethod ||
                (source === 'BuilderId' || source === 'Enterprise' ? 'IdC' : 'social')
            try {
                const response = await window.api.verifyAccountCredentials(
                    toIpcData({
                        refreshToken: credential.refreshToken,
                        clientId: credential.clientId || '',
                        clientSecret: credential.clientSecret || '',
                        region: credential.region || 'us-east-1',
                        authMethod: method,
                        provider: source
                    })
                )
                if (!current(session)) return
                if (!response.success || !response.data) {
                    result.failed += 1
                    failedIndices.push(index)
                    result.errors.push(`#${index + 1}: ${response.error || '验证失败'}`)
                    return
                }
                if (
                    !addVerified(
                        response.data as VerifiedData,
                        {
                            refreshToken: credential.refreshToken,
                            clientId: credential.clientId,
                            clientSecret: credential.clientSecret,
                            region: credential.region,
                            authMethod: method,
                            provider: source
                        },
                        'batch',
                        credential.password
                    )
                ) {
                    result.errors.push(
                        `#${index + 1}: ${response.data.email} ${isEn.value ? 'already exists' : '已存在'}`
                    )
                    return
                }
                result.success += 1
            } catch (cause) {
                if (!current(session)) return
                result.failed += 1
                failedIndices.push(index)
                result.errors.push(`#${index + 1}: ${message(cause)}`)
            }
        }
        const size = Math.max(1, settingsStore.batchImportConcurrency)
        for (let index = 0; index < credentials.length && current(session); index += size) {
            await Promise.allSettled(
                credentials
                    .slice(index, index + size)
                    .map((credential, offset) => process(credential, index + offset))
            )
            if (index + size < credentials.length && current(session))
                await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!current(session)) return
        oidcResult.value = result
        isSubmitting.value = false
        if (result.failed === 0) resetAfterSuccess()
        else {
            oidcBatchData.value = restoreFailedCredentials(credentials, failedIndices, parsed.kami)
            error.value = `成功导入 ${result.success} 个，失败 ${result.failed} 个`
        }
    }

    return {
        accountsStore,
        importMode,
        selectedGroupId,
        refreshToken,
        clientId,
        clientSecret,
        region,
        authMethod,
        provider,
        ssoToken,
        oidcImportMode,
        oidcBatchData,
        ssoResult,
        oidcResult,
        error,
        isVerifying,
        isSubmitting,
        importingLocal,
        loginType,
        isLoggingIn,
        usePrivateMode,
        builderIdLoginData,
        iamSsoLoginData,
        ssoStartUrl,
        copied,
        requestClose,
        cancelLogin,
        startBuilderId,
        startIamSso,
        startSocial,
        copyUserCode,
        importLocal,
        addSingleOidc,
        batchSso,
        batchOidc
    }
}
