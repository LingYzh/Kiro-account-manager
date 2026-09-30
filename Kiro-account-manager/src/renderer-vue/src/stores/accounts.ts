import type {
    Account,
    AccountExportData,
    AccountFilter,
    AccountGroup,
    AccountImportItem,
    AccountSort,
    AccountStats,
    AccountStatus,
    AccountSubscription,
    AccountTag,
    BatchOperationResult,
    IdpType,
    SubscriptionType
} from '@shared/types/account'
import { defineStore, getActivePinia } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { computed, ref } from 'vue'
import { generateRandomMachineId, isBannedAccountError } from '../lib/accountRuntime'
import { toIpcData } from '../lib/ipcData'
import { useAutoSwitchStore } from './autoSwitch'
import { useMachineIdStore } from './machineId'
import { usePersistenceStore } from './persistence'
import { useProxyPoolStore } from './proxyPool'
import { useSettingsStore } from './settings'
import { useWebhookStore, type WebhookEvent, type WebhookMessage } from './webhooks'

/** Vue 数据层：保留 React 既有动作与持久化边界，运行态归当前 Pinia 实例。 */
export const useAccountsStore = defineStore('kam-accounts', () => {
    const pinia = getActivePinia()!
    // 自动 Token 刷新定时器
    let tokenRefreshTimer: ReturnType<typeof setInterval> | null = null
    // 刷新提前量必须 ≥ 2× 检查间隔，否则账号会在两次 tick 之间过期：
    // 某次 tick 时剩余刚好略超阈值会被跳过，下一次 tick（间隔分钟后）时早已过期。
    // 再叠加 IPC + OIDC 网络刷新本身的耗时，余量不足就会出现"过期才刷"。
    const TOKEN_REFRESH_MIN_LEAD_MS = 10 * 60 * 1000
    function tokenRefreshLeadMs(intervalMin: number): number {
        return Math.max(intervalMin * 2 * 60 * 1000, TOKEN_REFRESH_MIN_LEAD_MS)
    }
    // 默认排序
    const defaultSort: AccountSort = { field: 'lastUsedAt', order: 'desc' }
    // 默认筛选
    const defaultFilter: AccountFilter = {}
    function loadActiveGroupTab(): string {
        try {
            return localStorage.getItem('accounts_activeGroupTab') || 'all'
        } catch {
            return 'all'
        }
    }
    const accounts = ref<Map<string, Account>>(new Map())
    const groups = ref<Map<string, AccountGroup>>(new Map())
    const tags = ref<Map<string, AccountTag>>(new Map())
    const activeAccountId = ref<string | null>(null)
    const filter = ref<AccountFilter>(defaultFilter)
    const activeGroupTab = ref<string>(loadActiveGroupTab())
    const sort = ref<AccountSort>(defaultSort)
    const selectedIds = ref<Set<string>>(new Set())
    function addAccount(accountData: Omit<Account, 'id' | 'createdAt' | 'isActive'>): string {
        const id = uuidv4()
        const now = Date.now()
        // 如果没有提供 machineId，自动生成一个随机的 64 位十六进制设备 ID
        const machineId = accountData.machineId || generateRandomMachineId()
        const account: Account = {
            ...accountData,
            id,
            machineId,
            createdAt: now,
            lastUsedAt: now,
            isActive: false,
            tags: accountData.tags || []
        }
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            accounts.set(id, account)
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return id
    }
    function updateAccount(id: string, updates: Partial<Account>): void {
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            const account = accounts.get(id)
            if (account) {
                accounts.set(id, { ...account, ...updates })
            }
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function removeAccount(id: string): void {
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts,
                selectedIds: useAccountsStore(pinia).selectedIds,
                activeAccountId: useAccountsStore(pinia).activeAccountId,
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const accounts = new Map(state.accounts)
            accounts.delete(id)
            const selectedIds = new Set(state.selectedIds)
            selectedIds.delete(id)
            const activeAccountId = state.activeAccountId === id ? null : state.activeAccountId
            // 同时清理账号-代理绑定
            const bindings = { ...state.accountProxyBindings }
            delete bindings[id]
            const changes: {
                accounts: Map<string, Account>
                selectedIds: Set<string>
                activeAccountId: string | null
                accountProxyBindings: Record<string, string>
            } = { accounts, selectedIds, activeAccountId, accountProxyBindings: bindings }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
                state.selectedIds = changes.selectedIds
                state.activeAccountId = changes.activeAccountId
            })
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function removeAccounts(ids: string[]): BatchOperationResult {
        const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts,
                selectedIds: useAccountsStore(pinia).selectedIds,
                activeAccountId: useAccountsStore(pinia).activeAccountId,
                accountProxyBindings: useProxyPoolStore(pinia).accountProxyBindings
            }
            const accounts = new Map(state.accounts)
            const selectedIds = new Set(state.selectedIds)
            let activeAccountId = state.activeAccountId
            const bindings = { ...state.accountProxyBindings }
            for (const id of ids) {
                if (accounts.has(id)) {
                    accounts.delete(id)
                    selectedIds.delete(id)
                    delete bindings[id]
                    if (activeAccountId === id) activeAccountId = null
                    result.success++
                } else {
                    result.failed++
                    result.errors.push({ id, error: 'Account not found' })
                }
            }
            const changes: {
                accounts: Map<string, Account>
                selectedIds: Set<string>
                activeAccountId: string | null
                accountProxyBindings: Record<string, string>
            } = { accounts, selectedIds, activeAccountId, accountProxyBindings: bindings }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
                state.selectedIds = changes.selectedIds
                state.activeAccountId = changes.activeAccountId
            })
            useProxyPoolStore(pinia).$patch((state) => {
                state.accountProxyBindings = changes.accountProxyBindings
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return result
    }
    async function setActiveAccount(id: string | null): Promise<void> {
        const state = {
            machineIdConfig: useMachineIdStore(pinia).machineIdConfig,
            accounts: useAccountsStore(pinia).accounts,
            accountMachineIds: useMachineIdStore(pinia).accountMachineIds
        }
        {
            const s = {
                accounts: useAccountsStore(pinia).accounts,
                activeAccountId: useAccountsStore(pinia).activeAccountId
            }
            const accounts = new Map(s.accounts)
            // 取消之前的激活状态
            if (s.activeAccountId) {
                const prev = accounts.get(s.activeAccountId)
                if (prev) {
                    accounts.set(s.activeAccountId, { ...prev, isActive: false })
                }
            }
            // 设置新的激活状态
            if (id) {
                const account = accounts.get(id)
                if (account) {
                    accounts.set(id, { ...account, isActive: true, lastUsedAt: Date.now() })
                }
            }
            const changes: {
                accounts: Map<string, Account>
                activeAccountId: string | null
            } = { accounts, activeAccountId: id }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
                state.activeAccountId = changes.activeAccountId
            })
        }
        // 切换账号时自动更换机器码（如果启用）
        if (id && state.machineIdConfig.autoSwitchOnAccountChange) {
            try {
                const account = state.accounts.get(id)
                if (state.machineIdConfig.bindMachineIdToAccount) {
                    // 使用账户绑定的机器码
                    let boundMachineId = state.accountMachineIds[id]
                    if (!boundMachineId) {
                        // 如果没有绑定机器码，为该账户生成一个
                        boundMachineId = await window.api.machineIdGenerateRandom()
                        useMachineIdStore(pinia).bindMachineIdToAccount(id, boundMachineId)
                    }
                    if (state.machineIdConfig.useBindedMachineId) {
                        // 使用绑定的机器码
                        await useMachineIdStore(pinia).changeMachineId(boundMachineId)
                    } else {
                        // 随机生成新机器码
                        await useMachineIdStore(pinia).changeMachineId()
                    }
                } else {
                    // 每次切换都随机生成新机器码
                    await useMachineIdStore(pinia).changeMachineId()
                }
                // 更新历史记录
                const newMachineId = useMachineIdStore(pinia).currentMachineId
                {
                    const s = {
                        machineIdHistory: useMachineIdStore(pinia).machineIdHistory
                    }
                    const changes: {
                        machineIdHistory: Array<{
                            id: string
                            machineId: string
                            timestamp: number
                            action: 'initial' | 'manual' | 'auto_switch' | 'restore' | 'bind'
                            accountId?: string
                            accountEmail?: string
                        }>
                    } = {
                        machineIdHistory: [
                            ...s.machineIdHistory,
                            {
                                id: crypto.randomUUID(),
                                machineId: newMachineId,
                                timestamp: Date.now(),
                                action: 'auto_switch' as const,
                                accountId: id,
                                accountEmail: account?.email
                            }
                        ]
                    }
                    useMachineIdStore(pinia).$patch((state) => {
                        state.machineIdHistory = changes.machineIdHistory
                    })
                }
                console.log(`[MachineId] Auto-switched machine ID for account: ${account?.email}`)
            } catch (error) {
                console.error('[MachineId] Failed to auto-switch machine ID:', error)
            }
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function getActiveAccount(): Account | null {
        const { accounts, activeAccountId } = {
            accounts: useAccountsStore(pinia).accounts,
            activeAccountId: useAccountsStore(pinia).activeAccountId
        }
        return activeAccountId ? (accounts.get(activeAccountId) ?? null) : null
    }
    function addGroup(groupData: Omit<AccountGroup, 'id' | 'createdAt' | 'order'>): string {
        const id = uuidv4()
        const { groups } = {
            groups: useAccountsStore(pinia).groups
        }
        const group: AccountGroup = {
            ...groupData,
            id,
            order: groups.size,
            createdAt: Date.now()
        }
        {
            const state = {
                groups: useAccountsStore(pinia).groups
            }
            const groups = new Map(state.groups)
            groups.set(id, group)
            const changes: {
                groups: Map<string, AccountGroup>
            } = { groups }
            useAccountsStore(pinia).$patch((state) => {
                state.groups = changes.groups
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return id
    }
    function updateGroup(id: string, updates: Partial<AccountGroup>): void {
        {
            const state = {
                groups: useAccountsStore(pinia).groups
            }
            const groups = new Map(state.groups)
            const group = groups.get(id)
            if (group) {
                groups.set(id, { ...group, ...updates })
            }
            const changes: {
                groups: Map<string, AccountGroup>
            } = { groups }
            useAccountsStore(pinia).$patch((state) => {
                state.groups = changes.groups
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function removeGroup(id: string): void {
        {
            const state = {
                groups: useAccountsStore(pinia).groups,
                accounts: useAccountsStore(pinia).accounts
            }
            const groups = new Map(state.groups)
            groups.delete(id)
            // 移除账号的分组引用
            const accounts = new Map(state.accounts)
            for (const [accountId, account] of accounts) {
                if (account.groupId === id) {
                    accounts.set(accountId, { ...account, groupId: undefined })
                }
            }
            const changes: {
                groups: Map<string, AccountGroup>
                accounts: Map<string, Account>
            } = { groups, accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.groups = changes.groups
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function moveAccountsToGroup(accountIds: string[], groupId: string | undefined): void {
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            for (const id of accountIds) {
                const account = accounts.get(id)
                if (account) {
                    accounts.set(id, { ...account, groupId })
                }
            }
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function addTag(tagData: Omit<AccountTag, 'id'>): string {
        const id = uuidv4()
        const tag: AccountTag = { ...tagData, id }
        {
            const state = {
                tags: useAccountsStore(pinia).tags
            }
            const tags = new Map(state.tags)
            tags.set(id, tag)
            const changes: {
                tags: Map<string, AccountTag>
            } = { tags }
            useAccountsStore(pinia).$patch((state) => {
                state.tags = changes.tags
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return id
    }
    function updateTag(id: string, updates: Partial<AccountTag>): void {
        {
            const state = {
                tags: useAccountsStore(pinia).tags
            }
            const tags = new Map(state.tags)
            const tag = tags.get(id)
            if (tag) {
                tags.set(id, { ...tag, ...updates })
            }
            const changes: {
                tags: Map<string, AccountTag>
            } = { tags }
            useAccountsStore(pinia).$patch((state) => {
                state.tags = changes.tags
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function removeTag(id: string): void {
        {
            const state = {
                tags: useAccountsStore(pinia).tags,
                accounts: useAccountsStore(pinia).accounts
            }
            const tags = new Map(state.tags)
            tags.delete(id)
            // 移除账号的标签引用
            const accounts = new Map(state.accounts)
            for (const [accountId, account] of accounts) {
                if (account.tags.includes(id)) {
                    accounts.set(accountId, {
                        ...account,
                        tags: account.tags.filter((t) => t !== id)
                    })
                }
            }
            const changes: {
                tags: Map<string, AccountTag>
                accounts: Map<string, Account>
            } = { tags, accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.tags = changes.tags
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function addTagToAccounts(accountIds: string[], tagId: string): void {
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            for (const id of accountIds) {
                const account = accounts.get(id)
                if (account && !account.tags.includes(tagId)) {
                    accounts.set(id, { ...account, tags: [...account.tags, tagId] })
                }
            }
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function removeTagFromAccounts(accountIds: string[], tagId: string): void {
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            for (const id of accountIds) {
                const account = accounts.get(id)
                if (account) {
                    accounts.set(id, {
                        ...account,
                        tags: account.tags.filter((t) => t !== tagId)
                    })
                }
            }
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
    }
    function setFilter(filter: AccountFilter): void {
        {
            const changes: {
                filter: AccountFilter
            } = { filter }
            useAccountsStore(pinia).$patch((state) => {
                state.filter = changes.filter
            })
        }
    }
    function clearFilter(): void {
        {
            const changes: {
                filter: AccountFilter
            } = { filter: defaultFilter }
            useAccountsStore(pinia).$patch((state) => {
                state.filter = changes.filter
            })
        }
    }
    function setActiveGroupTab(tab: string): void {
        try {
            localStorage.setItem('accounts_activeGroupTab', tab)
        } catch {
            /* no-op */
        }
        {
            const changes: {
                activeGroupTab: string
            } = { activeGroupTab: tab }
            useAccountsStore(pinia).$patch((state) => {
                state.activeGroupTab = changes.activeGroupTab
            })
        }
    }
    function setSort(sort: AccountSort): void {
        {
            const changes: {
                sort: AccountSort
            } = { sort }
            useAccountsStore(pinia).$patch((state) => {
                state.sort = changes.sort
            })
        }
    }
    function calculateFilteredAccounts(): Account[] {
        const { accounts, filter, sort, activeGroupTab } = {
            accounts: useAccountsStore(pinia).accounts,
            filter: useAccountsStore(pinia).filter,
            sort: useAccountsStore(pinia).sort,
            activeGroupTab: useAccountsStore(pinia).activeGroupTab
        }

        let result = Array.from(accounts.values())
        // 优先按分组 Tab 互斥过滤（与 filter.groupIds 独立）
        if (activeGroupTab === 'ungrouped') {
            result = result.filter((a) => !a.groupId)
        } else if (activeGroupTab !== 'all') {
            result = result.filter((a) => a.groupId === activeGroupTab)
        }
        // 应用筛选
        if (filter.search) {
            const search = filter.search.toLowerCase()
            result = result.filter(
                (a) =>
                    a.email.toLowerCase().includes(search) ||
                    a.nickname?.toLowerCase().includes(search)
            )
        }
        if (filter.subscriptionTypes?.length) {
            result = result.filter((a) => filter.subscriptionTypes!.includes(a.subscription.type))
        }
        if (filter.statuses?.length) {
            result = result.filter((a) => filter.statuses!.includes(a.status))
        }
        if (filter.idps?.length) {
            result = result.filter((a) => filter.idps!.includes(a.idp))
        }
        if (filter.groupIds?.length) {
            result = result.filter((a) => a.groupId && filter.groupIds!.includes(a.groupId))
        }
        if (filter.tagIds?.length) {
            result = result.filter((a) => filter.tagIds!.some((t) => a.tags.includes(t)))
        }
        if (filter.emailDomains?.length) {
            result = result.filter((a) => {
                const atIndex = a.email.lastIndexOf('@')
                if (atIndex < 0) return false
                const domain = a.email.slice(atIndex + 1).toLowerCase()
                return filter.emailDomains!.includes(domain)
            })
        }
        if (filter.usageMin !== undefined) {
            result = result.filter((a) => a.usage.percentUsed >= filter.usageMin!)
        }
        if (filter.usageMax !== undefined) {
            result = result.filter((a) => a.usage.percentUsed <= filter.usageMax!)
        }
        if (filter.daysRemainingMin !== undefined) {
            result = result.filter(
                (a) =>
                    a.subscription.daysRemaining !== undefined &&
                    a.subscription.daysRemaining >= filter.daysRemainingMin!
            )
        }
        if (filter.daysRemainingMax !== undefined) {
            result = result.filter(
                (a) =>
                    a.subscription.daysRemaining !== undefined &&
                    a.subscription.daysRemaining <= filter.daysRemainingMax!
            )
        }
        // 封禁筛选
        if (filter.bannedOnly) {
            result = result.filter((a) => isBannedAccountError(a.lastError))
        }
        // 应用排序
        result.sort((a, b) => {
            let cmp = 0
            switch (sort.field) {
                case 'email':
                    cmp = a.email.localeCompare(b.email)
                    break
                case 'nickname':
                    cmp = (a.nickname ?? '').localeCompare(b.nickname ?? '')
                    break
                case 'subscription':
                    cmp = a.subscription.type.localeCompare(b.subscription.type)
                    break
                case 'usage':
                    cmp = a.usage.percentUsed - b.usage.percentUsed
                    break
                case 'daysRemaining':
                    cmp =
                        (a.subscription.daysRemaining ?? 999) -
                        (b.subscription.daysRemaining ?? 999)
                    break
                case 'lastUsedAt':
                    cmp = a.lastUsedAt - b.lastUsedAt
                    break
                case 'createdAt':
                    cmp = a.createdAt - b.createdAt
                    break
                case 'status':
                    cmp = a.status.localeCompare(b.status)
                    break
            }
            return sort.order === 'desc' ? -cmp : cmp
        })
        return result
    }
    const filteredAccounts = computed(calculateFilteredAccounts)
    function getFilteredAccounts(): Account[] {
        return filteredAccounts.value
    }

    function selectAccount(id: string): void {
        {
            const state = {
                selectedIds: useAccountsStore(pinia).selectedIds
            }
            const selectedIds = new Set(state.selectedIds)
            selectedIds.add(id)
            const changes: {
                selectedIds: Set<string>
            } = { selectedIds }
            useAccountsStore(pinia).$patch((state) => {
                state.selectedIds = changes.selectedIds
            })
        }
    }
    function deselectAccount(id: string): void {
        {
            const state = {
                selectedIds: useAccountsStore(pinia).selectedIds
            }
            const selectedIds = new Set(state.selectedIds)
            selectedIds.delete(id)
            const changes: {
                selectedIds: Set<string>
            } = { selectedIds }
            useAccountsStore(pinia).$patch((state) => {
                state.selectedIds = changes.selectedIds
            })
        }
    }
    function selectAll(): void {
        const filtered = useAccountsStore(pinia).getFilteredAccounts()
        {
            const changes: {
                selectedIds: Set<string>
            } = { selectedIds: new Set(filtered.map((a) => a.id)) }
            useAccountsStore(pinia).$patch((state) => {
                state.selectedIds = changes.selectedIds
            })
        }
    }
    function deselectAll(): void {
        {
            const changes: {
                selectedIds: Set<string>
            } = { selectedIds: new Set() }
            useAccountsStore(pinia).$patch((state) => {
                state.selectedIds = changes.selectedIds
            })
        }
    }
    function toggleSelection(id: string): void {
        {
            const state = {
                selectedIds: useAccountsStore(pinia).selectedIds
            }
            const selectedIds = new Set(state.selectedIds)
            if (selectedIds.has(id)) {
                selectedIds.delete(id)
            } else {
                selectedIds.add(id)
            }
            const changes: {
                selectedIds: Set<string>
            } = { selectedIds }
            useAccountsStore(pinia).$patch((state) => {
                state.selectedIds = changes.selectedIds
            })
        }
    }
    function getSelectedAccounts(): Account[] {
        const { accounts, selectedIds } = {
            accounts: useAccountsStore(pinia).accounts,
            selectedIds: useAccountsStore(pinia).selectedIds
        }
        return Array.from(selectedIds)
            .map((id) => accounts.get(id))
            .filter((a): a is Account => a !== undefined)
    }
    function exportAccounts(ids?: string[]): AccountExportData {
        const { accounts, groups, tags } = {
            accounts: useAccountsStore(pinia).accounts,
            groups: useAccountsStore(pinia).groups,
            tags: useAccountsStore(pinia).tags
        }
        let exportAccounts: Account[]
        if (ids?.length) {
            exportAccounts = ids
                .map((id) => accounts.get(id))
                .filter((a): a is Account => a !== undefined)
        } else {
            exportAccounts = Array.from(accounts.values())
        }

        const data: AccountExportData = {
            version: useSettingsStore(pinia).appVersion,
            exportedAt: Date.now(),
            accounts: exportAccounts.map(({ isActive, ...rest }) => {
                void isActive
                return rest
            }),
            groups: Array.from(groups.values()),
            tags: Array.from(tags.values())
        }
        return data
    }
    function importAccounts(items: AccountImportItem[]): BatchOperationResult {
        const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
        // 验证 idp 是否有效
        const validIdps = ['Google', 'Github', 'BuilderId'] as const
        const normalizeIdp = (idp?: string): IdpType => {
            if (!idp) return 'Google'
            const normalized = validIdps.find((v) => v.toLowerCase() === idp.toLowerCase())
            return normalized || 'Google'
        }
        // 批量构造账号对象 + 一次 set，避免 N 次 new Map(O(n²)) 与 N 次 re-render
        const newAccounts: Account[] = []
        for (const item of items) {
            try {
                const now = Date.now()
                const id = uuidv4()
                const machineId = generateRandomMachineId()
                const account: Account = {
                    id,
                    createdAt: now,
                    isActive: false,
                    machineId,
                    email: item.email,
                    password: item.password,
                    nickname: item.nickname,
                    idp: normalizeIdp(item.idp as string),
                    credentials: {
                        accessToken: item.accessToken || '',
                        csrfToken: item.csrfToken || '',
                        refreshToken: item.refreshToken,
                        clientId: item.clientId,
                        clientSecret: item.clientSecret,
                        region: item.region || 'us-east-1',
                        expiresAt: now + 3600 * 1000
                    },
                    subscription: {
                        type: 'Free'
                    },
                    usage: {
                        current: 0,
                        limit: 25,
                        percentUsed: 0,
                        lastUpdated: now
                    },
                    groupId: item.groupId,
                    tags: item.tags ?? [],
                    status: 'unknown',
                    lastUsedAt: now
                }
                newAccounts.push(account)
                result.success++
            } catch (error) {
                result.failed++
                result.errors.push({
                    id: item.email,
                    error: error instanceof Error ? error.message : 'Unknown error'
                })
            }
        }
        if (newAccounts.length > 0) {
            {
                const state = {
                    accounts: useAccountsStore(pinia).accounts
                }
                // 仅一次完整 Map 复制
                const accounts = new Map(state.accounts)
                for (const account of newAccounts) {
                    accounts.set(account.id, account)
                }
                const changes: {
                    accounts: Map<string, Account>
                } = { accounts }
                useAccountsStore(pinia).$patch((state) => {
                    state.accounts = changes.accounts
                })
            }
            // 防抖触发一次持久化
            usePersistenceStore(pinia).saveToStorage()
        }
        return result
    }
    function importFromExportData(data: AccountExportData): BatchOperationResult {
        const result: BatchOperationResult = { success: 0, failed: 0, errors: [] }
        const { accounts: existingAccounts } = {
            accounts: useAccountsStore(pinia).accounts
        }
        // 检查账户是否已存在（同邮箱+同provider 或 同userId 才算重复）
        const isAccountExists = (email: string, userId?: string, provider?: string): boolean => {
            return Array.from(existingAccounts.values()).some((acc) => {
                // userId 相同则重复
                if (userId && acc.userId === userId) return true
                // email 相同且 provider 相同则重复（允许同邮箱不同登录方式）
                if (acc.email === email && acc.credentials.provider === provider) return true
                return false
            })
        }
        // 去重：文件内部去重
        const seenEmails = new Set<string>()
        const seenUserIds = new Set<string>()
        const uniqueAccounts = data.accounts.filter((acc) => {
            if (seenEmails.has(acc.email) || (acc.userId && seenUserIds.has(acc.userId))) {
                return false
            }
            seenEmails.add(acc.email)
            if (acc.userId) seenUserIds.add(acc.userId)
            return true
        })
        // 收集所有变更，一次性 set，避免 N 次 new Map（O(n²)）
        let skipped = 0
        const accountsToAdd: Account[] = []
        for (const accountData of uniqueAccounts) {
            // 检查本地是否已存在（传入 provider 参数）
            if (
                isAccountExists(
                    accountData.email,
                    accountData.userId,
                    accountData.credentials?.provider
                )
            ) {
                skipped++
                continue
            }
            try {
                accountsToAdd.push({ ...accountData, isActive: false })
                result.success++
            } catch (error) {
                result.failed++
                result.errors.push({
                    id: accountData.id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                })
            }
        }
        // 一次 set 应用所有分组、标签、账号 — 单次 re-render
        if (data.groups.length > 0 || data.tags.length > 0 || accountsToAdd.length > 0) {
            {
                const state = {
                    groups: useAccountsStore(pinia).groups,
                    tags: useAccountsStore(pinia).tags,
                    accounts: useAccountsStore(pinia).accounts
                }
                const groups = data.groups.length > 0 ? new Map(state.groups) : state.groups
                if (data.groups.length > 0) {
                    for (const group of data.groups) groups.set(group.id, group)
                }
                const tags = data.tags.length > 0 ? new Map(state.tags) : state.tags
                if (data.tags.length > 0) {
                    for (const tag of data.tags) tags.set(tag.id, tag)
                }
                const accounts = accountsToAdd.length > 0 ? new Map(state.accounts) : state.accounts
                if (accountsToAdd.length > 0) {
                    for (const acc of accountsToAdd) accounts.set(acc.id, acc)
                }
                const changes: {
                    groups: Map<string, AccountGroup>
                    tags: Map<string, AccountTag>
                    accounts: Map<string, Account>
                } = { groups, tags, accounts }
                useAccountsStore(pinia).$patch((state) => {
                    state.groups = changes.groups
                    state.tags = changes.tags
                    state.accounts = changes.accounts
                })
            }
        }
        // 记录跳过数量
        if (skipped > 0) {
            result.errors.push({
                id: 'skipped',
                error: `跳过 ${skipped} 个已存在的账号`
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        return result
    }
    function updateAccountStatus(id: string, status: AccountStatus, error?: string): void {
        const wasBanned = isBannedAccountError(useAccountsStore(pinia).accounts.get(id)?.lastError)
        const isBanned = isBannedAccountError(error)
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            const account = accounts.get(id)
            if (account) {
                accounts.set(id, {
                    ...account,
                    status,
                    lastError: error,
                    lastCheckedAt: Date.now()
                })
            }
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
        usePersistenceStore(pinia).saveToStorage()
        // 触发 webhook：账号刚被封禁时通知（已封禁的不重复）
        if (isBanned && !wasBanned) {
            const acc = useAccountsStore(pinia).accounts.get(id)
            triggerWebhook('account-banned', {
                title: '账号被封禁',
                message: `账号 ${acc?.email || id} 状态变为封禁`,
                level: 'error',
                fields: { 邮箱: acc?.email || '-', 错误: error || '-' }
            })
        }
    }
    async function refreshAccountToken(id: string): Promise<boolean> {
        const { accounts, updateAccountStatus } = {
            accounts: useAccountsStore(pinia).accounts,
            updateAccountStatus: useAccountsStore(pinia).updateAccountStatus
        }
        const account = accounts.get(id)
        if (!account) return false
        updateAccountStatus(id, 'refreshing')
        try {
            // 通过主进程调用 Kiro API 刷新 Token（避免 CORS）
            const result = await window.api.refreshAccountToken(toIpcData(account))
            if (result.success && result.data) {
                // 当 refresh 后 main 进程检测到该账号是 IDE 当前激活账号，会自动同步到磁盘 token 文件；
                // 否则只更新反代 store，IDE 仍用旧 token —— 提醒用户避免误以为"刷新对 IDE 也生效了"
                if (result.data.syncedToIde) {
                    console.log(
                        `[refreshAccountToken] Token refreshed AND synced to Kiro IDE (account=${account.email})`
                    )
                } else {
                    console.warn(
                        `[refreshAccountToken] Token refreshed but NOT synced to Kiro IDE (account=${account.email}). ` +
                            `Reason: ${result.data.syncSkipReason || 'unknown'}. ` +
                            `Kiro IDE will still use its previously cached token until its own refresh loop kicks in.`
                    )
                }
                {
                    const state = {
                        accounts: useAccountsStore(pinia).accounts
                    }
                    const accounts = new Map(state.accounts)
                    const acc = accounts.get(id)
                    if (acc) {
                        // Enterprise 账号刷新时主进程会返回真实 profileArn，持久化避免后续重复获取
                        const resolvedProfileArn =
                            result.data!.profileArn || acc.credentials.profileArn || acc.profileArn
                        accounts.set(id, {
                            ...acc,
                            profileArn: resolvedProfileArn,
                            credentials: {
                                ...acc.credentials,
                                accessToken: result.data!.accessToken,
                                // 如果返回了新的 refreshToken，更新它
                                refreshToken:
                                    result.data!.refreshToken || acc.credentials.refreshToken,
                                expiresAt: Date.now() + result.data!.expiresIn * 1000,
                                profileArn: resolvedProfileArn
                            },
                            status: 'active',
                            lastError: undefined,
                            lastCheckedAt: Date.now()
                        })
                    }
                    const changes: {
                        accounts: Map<string, Account>
                    } = { accounts }
                    useAccountsStore(pinia).$patch((state) => {
                        state.accounts = changes.accounts
                    })
                }
                usePersistenceStore(pinia).saveToStorage()
                return true
            } else {
                updateAccountStatus(id, 'error', result.error?.message)
                // 触发 webhook：Token 刷新失败
                triggerWebhook('token-expired', {
                    title: 'Token 刷新失败',
                    message: `账号 ${account.email} Token 刷新失败`,
                    level: 'warn',
                    fields: { 邮箱: account.email, 错误: result.error?.message || '-' }
                })
                return false
            }
        } catch (error) {
            updateAccountStatus(
                id,
                'error',
                error instanceof Error ? error.message : 'Unknown error'
            )
            return false
        }
    }
    async function batchRefreshTokens(ids: string[]): Promise<BatchOperationResult> {
        const { accounts, autoRefreshConcurrency } = {
            accounts: useAccountsStore(pinia).accounts,
            autoRefreshConcurrency: useSettingsStore(pinia).autoRefreshConcurrency
        }
        // 收集需要刷新的账号
        const accountsToRefresh: Array<{
            id: string
            email: string
            profileArn?: string
            credentials: {
                refreshToken: string
                clientId?: string
                clientSecret?: string
                region?: string
                authMethod?: string
                accessToken?: string
                provider?: string
                profileArn?: string
            }
        }> = []
        for (const id of ids) {
            const account = accounts.get(id)
            if (!account?.credentials.refreshToken) continue
            accountsToRefresh.push({
                id,
                email: account.email,
                profileArn: account.profileArn,
                credentials: {
                    refreshToken: account.credentials.refreshToken,
                    clientId: account.credentials.clientId,
                    clientSecret: account.credentials.clientSecret,
                    region: account.credentials.region,
                    authMethod: account.credentials.authMethod,
                    accessToken: account.credentials.accessToken,
                    provider: account.credentials.provider || account.idp,
                    profileArn: account.credentials.profileArn
                }
            })
        }
        if (accountsToRefresh.length === 0) {
            return { success: 0, failed: 0, errors: [] }
        }
        console.log(
            `[BatchRefresh] Triggering background refresh for ${accountsToRefresh.length} accounts...`
        )
        // 使用后台刷新 API（不阻塞 UI）
        const result = await window.api.backgroundBatchRefresh(
            toIpcData(accountsToRefresh),
            toIpcData(autoRefreshConcurrency)
        )
        return {
            success: result.successCount,
            failed: result.failedCount,
            errors: []
        }
    }
    async function checkAccountStatus(id: string): Promise<void> {
        const { accounts, updateAccountStatus } = {
            accounts: useAccountsStore(pinia).accounts,
            updateAccountStatus: useAccountsStore(pinia).updateAccountStatus
        }
        const account = accounts.get(id)
        if (!account) return
        // 设置刷新状态，提供视觉反馈
        updateAccountStatus(id, 'refreshing')
        try {
            // 通过主进程调用 Kiro API 获取状态（避免 CORS）
            const result = await window.api.checkAccountStatus(toIpcData(account))
            if (result.success && result.data) {
                {
                    const state = {
                        accounts: useAccountsStore(pinia).accounts
                    }
                    const accounts = new Map(state.accounts)
                    const acc = accounts.get(id)
                    if (acc) {
                        // 如果 token 被刷新，更新凭证
                        const updatedCredentials = result.data!.newCredentials
                            ? {
                                  ...acc.credentials,
                                  accessToken: result.data!.newCredentials.accessToken,
                                  refreshToken:
                                      result.data!.newCredentials.refreshToken ??
                                      acc.credentials.refreshToken,
                                  expiresAt:
                                      result.data!.newCredentials.expiresAt ??
                                      acc.credentials.expiresAt
                              }
                            : acc.credentials
                        // 合并 usage 数据，确保包含所有必要字段
                        const apiUsage = result.data!.usage
                        const mergedUsage = apiUsage
                            ? {
                                  current: apiUsage.current ?? acc.usage.current,
                                  limit: apiUsage.limit ?? acc.usage.limit,
                                  percentUsed:
                                      apiUsage.limit > 0 ? apiUsage.current / apiUsage.limit : 0,
                                  lastUpdated: apiUsage.lastUpdated ?? Date.now(),
                                  baseLimit: apiUsage.baseLimit,
                                  baseCurrent: apiUsage.baseCurrent,
                                  freeTrialLimit: apiUsage.freeTrialLimit,
                                  freeTrialCurrent: apiUsage.freeTrialCurrent,
                                  freeTrialExpiry: apiUsage.freeTrialExpiry,
                                  bonuses: apiUsage.bonuses,
                                  nextResetDate: apiUsage.nextResetDate,
                                  resourceDetail: apiUsage.resourceDetail
                              }
                            : acc.usage
                        // 合并订阅信息
                        const apiSub = result.data!.subscription
                        const mergedSubscription = apiSub
                            ? {
                                  ...acc.subscription,
                                  ...apiSub
                              }
                            : acc.subscription
                        // 转换 IDP 类型（保持原值优先，只有明确匹配时才更新）
                        const apiIdp = result.data!.idp
                        let idpType = acc.idp
                        if (apiIdp) {
                            if (apiIdp === 'BuilderId') idpType = 'BuilderId'
                            else if (apiIdp === 'Google') idpType = 'Google'
                            else if (apiIdp === 'Github') idpType = 'Github'
                            else if (apiIdp === 'AWSIdC') idpType = 'AWSIdC'
                            else if (apiIdp === 'Enterprise' || apiIdp === 'Internal')
                                idpType = 'Enterprise'
                            // 未知类型保持原值，不强制改为 Internal
                        }
                        accounts.set(id, {
                            ...acc,
                            // 更新邮箱（如果 API 返回了）
                            email: result.data!.email ?? acc.email,
                            userId: result.data!.userId ?? acc.userId,
                            idp: idpType,
                            status: result.data!.status as AccountStatus,
                            usage: mergedUsage,
                            subscription: mergedSubscription as AccountSubscription,
                            credentials: updatedCredentials,
                            lastCheckedAt: Date.now(),
                            lastError: undefined
                        })
                    }
                    const changes: {
                        accounts: Map<string, Account>
                    } = { accounts }
                    useAccountsStore(pinia).$patch((state) => {
                        state.accounts = changes.accounts
                    })
                }
                usePersistenceStore(pinia).saveToStorage()
                // 如果刷新了 token，打印日志
                if (result.data.newCredentials) {
                    console.log(`[Account] Token refreshed for ${account?.email}`)
                }
            } else {
                // 检查是否是封禁错误
                const isBanned = (
                    result.error as {
                        isBanned?: boolean
                    }
                )?.isBanned
                if (isBanned) {
                    // 封禁账户：设置错误状态并标记为封禁
                    updateAccountStatus(id, 'error', `账户已封禁: ${result.error?.message}`)
                } else {
                    updateAccountStatus(id, 'error', result.error?.message)
                }
            }
        } catch (error) {
            updateAccountStatus(
                id,
                'error',
                error instanceof Error ? error.message : 'Unknown error'
            )
        }
    }
    async function batchCheckStatus(ids: string[]): Promise<BatchOperationResult> {
        const { accounts, autoRefreshConcurrency } = {
            accounts: useAccountsStore(pinia).accounts,
            autoRefreshConcurrency: useSettingsStore(pinia).autoRefreshConcurrency
        }
        // 收集需要检查的账号（使用批量检查 API，不刷新 Token）
        const accountsToCheck: Array<{
            id: string
            email: string
            credentials: {
                accessToken: string
                refreshToken?: string
                clientId?: string
                clientSecret?: string
                region?: string
                authMethod?: string
                provider?: string
            }
            idp?: string
        }> = []
        for (const id of ids) {
            const account = accounts.get(id)
            if (!account?.credentials.accessToken) continue
            accountsToCheck.push({
                id,
                email: account.email,
                credentials: {
                    accessToken: account.credentials.accessToken,
                    refreshToken: account.credentials.refreshToken,
                    clientId: account.credentials.clientId,
                    clientSecret: account.credentials.clientSecret,
                    region: account.credentials.region,
                    authMethod: account.credentials.authMethod,
                    provider: account.credentials.provider
                },
                idp: account.idp
            })
        }
        if (accountsToCheck.length === 0) {
            return { success: 0, failed: 0, errors: [] }
        }
        console.log(
            `[BatchCheck] Triggering background check for ${accountsToCheck.length} accounts...`
        )
        // 使用后台检查 API（只检查状态，不刷新 Token）
        const result = await window.api.backgroundBatchCheck(
            toIpcData(accountsToCheck),
            toIpcData(autoRefreshConcurrency)
        )
        return {
            success: result.successCount,
            failed: result.failedCount,
            errors: []
        }
    }
    function calculateStats(): AccountStats {
        const { accounts } = {
            accounts: useAccountsStore(pinia).accounts
        }

        const accountList = Array.from(accounts.values())
        const stats: AccountStats = {
            total: accountList.length,
            byStatus: {
                active: 0,
                expired: 0,
                error: 0,
                refreshing: 0,
                unknown: 0
            },
            bySubscription: {
                Free: 0,
                Pro: 0,
                Pro_Plus: 0,
                Enterprise: 0,
                Teams: 0
            },
            byIdp: {
                Google: 0,
                Github: 0,
                BuilderId: 0,
                Enterprise: 0,
                AWSIdC: 0,
                Internal: 0,
                IAM_SSO: 0
            },
            activeCount: 0,
            expiringSoonCount: 0,
            bannedCount: 0
        }
        for (const account of accountList) {
            stats.byStatus[account.status]++
            stats.bySubscription[account.subscription.type]++
            stats.byIdp[account.idp]++
            if (account.isActive) stats.activeCount++
            if (
                account.subscription.daysRemaining !== undefined &&
                account.subscription.daysRemaining <= 7
            ) {
                stats.expiringSoonCount++
            }
            // 统计封禁账号
            if (isBannedAccountError(account.lastError)) {
                stats.bannedCount++
            }
        }
        return stats
    }
    const stats = computed(calculateStats)
    function getStats(): AccountStats {
        return stats.value
    }

    async function checkAndRefreshExpiringTokens(): Promise<void> {
        const {
            accounts,
            refreshAccountToken,
            checkAccountStatus,
            autoSwitchEnabled,
            autoRefreshConcurrency,
            autoRefreshSyncInfo,
            autoRefreshInterval
        } = {
            accounts: useAccountsStore(pinia).accounts,
            refreshAccountToken: useAccountsStore(pinia).refreshAccountToken,
            checkAccountStatus: useAccountsStore(pinia).checkAccountStatus,
            autoSwitchEnabled: useAutoSwitchStore(pinia).autoSwitchEnabled,
            autoRefreshConcurrency: useSettingsStore(pinia).autoRefreshConcurrency,
            autoRefreshSyncInfo: useSettingsStore(pinia).autoRefreshSyncInfo,
            autoRefreshInterval: useSettingsStore(pinia).autoRefreshInterval
        }
        const now = Date.now()
        const refreshLeadMs = tokenRefreshLeadMs(autoRefreshInterval)
        console.log(
            `[AutoRefresh] Checking ${accounts.size} accounts... (syncInfo: ${autoRefreshSyncInfo}, autoSwitch: ${autoSwitchEnabled})`
        )
        // 筛选需要处理的账号
        const accountsToProcess: Array<{
            id: string
            email: string
            needsTokenRefresh: boolean
        }> = []
        for (const [id, account] of accounts) {
            // 跳过已封禁或错误状态的账号
            if (isBannedAccountError(account.lastError)) {
                console.log(`[AutoRefresh] Skipping ${account.email} (banned/error)`)
                continue
            }
            const expiresAt = account.credentials.expiresAt
            const timeUntilExpiry = expiresAt ? expiresAt - now : Infinity
            const needsTokenRefresh = expiresAt && timeUntilExpiry <= refreshLeadMs
            accountsToProcess.push({
                id,
                email: account.email,
                needsTokenRefresh: !!needsTokenRefresh
            })
        }
        console.log(`[AutoRefresh] Processing ${accountsToProcess.length} accounts...`)
        // 并发控制：使用配置的并发数，避免卡顿
        const BATCH_SIZE = autoRefreshConcurrency
        let successCount = 0
        let failCount = 0
        for (let i = 0; i < accountsToProcess.length; i += BATCH_SIZE) {
            const batch = accountsToProcess.slice(i, i + BATCH_SIZE)
            const results = await Promise.allSettled(
                batch.map(async ({ id, email, needsTokenRefresh }) => {
                    try {
                        if (needsTokenRefresh) {
                            console.log(`[AutoRefresh] Refreshing token for ${email}...`)
                            await refreshAccountToken(id)
                            console.log(`[AutoRefresh] Token for ${email} refreshed`)
                            // Token 刷新后同步刷新账户信息
                            await checkAccountStatus(id)
                            console.log(`[AutoRefresh] Account info for ${email} updated`)
                        } else if (autoRefreshSyncInfo || autoSwitchEnabled) {
                            // 开启同步检测账户信息或自动换号时，刷新账户信息
                            await checkAccountStatus(id)
                            console.log(`[AutoRefresh] Account info for ${email} updated`)
                        }
                        return { email, success: true }
                    } catch (e) {
                        console.error(`[AutoRefresh] Failed for ${email}:`, e)
                        return { email, success: false, error: e }
                    }
                })
            )
            successCount += results.filter(
                (r) => r.status === 'fulfilled' && r.value.success
            ).length
            failCount +=
                results.length -
                results.filter((r) => r.status === 'fulfilled' && r.value.success).length
            // 批次间延迟
            if (i + BATCH_SIZE < accountsToProcess.length) {
                await new Promise((resolve) => setTimeout(resolve, 200))
            }
        }
        console.log(`[AutoRefresh] Completed: ${successCount} success, ${failCount} failed`)
    }
    async function refreshExpiredTokensOnly(): Promise<void> {
        const { accounts, refreshAccountToken, autoRefreshConcurrency, autoRefreshInterval } = {
            accounts: useAccountsStore(pinia).accounts,
            refreshAccountToken: useAccountsStore(pinia).refreshAccountToken,
            autoRefreshConcurrency: useSettingsStore(pinia).autoRefreshConcurrency,
            autoRefreshInterval: useSettingsStore(pinia).autoRefreshInterval
        }
        const now = Date.now()
        const refreshLeadMs = tokenRefreshLeadMs(autoRefreshInterval)
        // 筛选需要刷新 Token 的账号
        const expiredAccounts: Array<{
            id: string
            email: string
        }> = []
        for (const [id, account] of accounts) {
            // 跳过已封禁或错误状态的账号
            if (isBannedAccountError(account.lastError)) {
                continue
            }
            const expiresAt = account.credentials.expiresAt
            const timeUntilExpiry = expiresAt ? expiresAt - now : Infinity
            // Token 已过期或即将过期
            if (expiresAt && timeUntilExpiry <= refreshLeadMs) {
                expiredAccounts.push({ id, email: account.email })
            }
        }
        if (expiredAccounts.length === 0) {
            console.log('[AutoRefresh] No expired tokens found')
            return
        }
        console.log(`[AutoRefresh] Refreshing ${expiredAccounts.length} expired tokens...`)
        // 并发控制：使用配置的并发数，避免卡顿
        const BATCH_SIZE = autoRefreshConcurrency
        for (let i = 0; i < expiredAccounts.length; i += BATCH_SIZE) {
            const batch = expiredAccounts.slice(i, i + BATCH_SIZE)
            await Promise.allSettled(
                batch.map(async ({ id, email }) => {
                    try {
                        await refreshAccountToken(id)
                        console.log(`[AutoRefresh] Token for ${email} refreshed`)
                    } catch (e) {
                        console.error(`[AutoRefresh] Failed to refresh token for ${email}:`, e)
                    }
                })
            )
            // 批次间延迟
            if (i + BATCH_SIZE < expiredAccounts.length) {
                await new Promise((resolve) => setTimeout(resolve, 200))
            }
        }
    }
    function startAutoTokenRefresh(): void {
        const { autoRefreshEnabled, autoRefreshInterval } = {
            autoRefreshEnabled: useSettingsStore(pinia).autoRefreshEnabled,
            autoRefreshInterval: useSettingsStore(pinia).autoRefreshInterval
        }
        // 如果已有定时器，先停止
        if (tokenRefreshTimer) {
            clearInterval(tokenRefreshTimer)
            tokenRefreshTimer = null
        }
        // 如果未启用，不启动定时器
        if (!autoRefreshEnabled) {
            console.log('[AutoRefresh] Auto-refresh is disabled')
            return
        }
        // 启动时触发后台刷新（在主进程执行，不阻塞 UI）
        useAccountsStore(pinia).triggerBackgroundRefresh()
        // 使用用户设置的间隔（分钟转毫秒）
        const intervalMs = autoRefreshInterval * 60 * 1000
        tokenRefreshTimer = setInterval(() => {
            useAccountsStore(pinia).triggerBackgroundRefresh()
        }, intervalMs)
        console.log(
            `[AutoRefresh] Token auto-refresh started with interval: ${autoRefreshInterval} minutes`
        )
    }
    function stopAutoTokenRefresh(): void {
        if (tokenRefreshTimer) {
            clearInterval(tokenRefreshTimer)
            tokenRefreshTimer = null
            console.log('[AutoRefresh] Token auto-refresh stopped')
        }
    }
    async function triggerBackgroundRefresh(): Promise<void> {
        const {
            accounts,
            autoRefreshConcurrency,
            autoRefreshSyncInfo,
            autoSwitchEnabled,
            autoRefreshInterval
        } = {
            accounts: useAccountsStore(pinia).accounts,
            autoRefreshConcurrency: useSettingsStore(pinia).autoRefreshConcurrency,
            autoRefreshSyncInfo: useSettingsStore(pinia).autoRefreshSyncInfo,
            autoSwitchEnabled: useAutoSwitchStore(pinia).autoSwitchEnabled,
            autoRefreshInterval: useSettingsStore(pinia).autoRefreshInterval
        }
        const now = Date.now()
        const refreshLeadMs = tokenRefreshLeadMs(autoRefreshInterval)
        // 筛选需要处理的账号
        const accountsToRefresh: Array<{
            id: string
            email: string
            idp?: string
            profileArn?: string
            needsTokenRefresh: boolean
            machineId?: string // 账户绑定的设备 ID
            credentials: {
                refreshToken: string
                clientId?: string
                clientSecret?: string
                region?: string
                authMethod?: string
                accessToken?: string
                provider?: string
                profileArn?: string
            }
        }> = []
        for (const [id, account] of accounts) {
            // 跳过已封禁或错误状态的账号
            if (isBannedAccountError(account.lastError)) {
                continue
            }
            const expiresAt = account.credentials.expiresAt
            const timeUntilExpiry = expiresAt ? expiresAt - now : Infinity
            const needsTokenRefresh = expiresAt && timeUntilExpiry <= refreshLeadMs
            // Token 即将过期需要刷新，或开启了同步检测/自动换号需要检查账户信息
            if (needsTokenRefresh || autoRefreshSyncInfo || autoSwitchEnabled) {
                accountsToRefresh.push({
                    id,
                    email: account.email,
                    idp: account.idp,
                    profileArn: account.profileArn,
                    needsTokenRefresh: !!needsTokenRefresh,
                    machineId: account.machineId, // 传递账户绑定的设备 ID
                    credentials: {
                        refreshToken: account.credentials.refreshToken || '',
                        clientId: account.credentials.clientId,
                        clientSecret: account.credentials.clientSecret,
                        region: account.credentials.region,
                        authMethod: account.credentials.authMethod,
                        accessToken: account.credentials.accessToken,
                        provider: account.credentials.provider,
                        profileArn: account.credentials.profileArn
                    }
                })
            }
        }
        if (accountsToRefresh.length === 0) {
            console.log('[BackgroundRefresh] No accounts need processing')
            return
        }
        console.log(
            `[BackgroundRefresh] Triggering refresh for ${accountsToRefresh.length} accounts (syncInfo: ${autoRefreshSyncInfo})...`
        )
        // 调用主进程后台刷新，不等待结果（通过 IPC 事件接收）
        window.api.backgroundBatchRefresh(
            toIpcData(accountsToRefresh),
            toIpcData(autoRefreshConcurrency),
            toIpcData(autoRefreshSyncInfo)
        )
    }
    function handleBackgroundRefreshResult(data: {
        id: string
        success: boolean
        data?: unknown
        error?: string
    }): void {
        useAccountsStore(pinia).applyBackgroundRefreshResults([data])
    }
    function applyBackgroundRefreshResults(
        items: Array<{
            id: string
            success: boolean
            data?: unknown
            error?: string
        }>
    ): void {
        if (!items || items.length === 0) return
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            // 仅一次完整 Map 复制
            const accounts = new Map(state.accounts)
            const now = Date.now()
            for (const data of items) {
                const { id, success, data: resultData, error } = data
                const account = accounts.get(id)
                if (!account) continue
                if (!success) {
                    accounts.set(id, {
                        ...account,
                        status: 'error',
                        lastError: error,
                        lastCheckedAt: now
                    })
                    continue
                }
                const refreshData = resultData as
                    | {
                          accessToken?: string
                          refreshToken?: string
                          expiresIn?: number
                          profileArn?: string
                          usage?: {
                              current?: number
                              limit?: number
                              baseCurrent?: number
                              baseLimit?: number
                              freeTrialCurrent?: number
                              freeTrialLimit?: number
                              freeTrialExpiry?: string
                              bonuses?: Array<{
                                  code: string
                                  name: string
                                  current: number
                                  limit: number
                                  expiresAt?: string
                              }>
                              nextResetDate?: string
                              resourceDetail?: {
                                  displayName?: string
                                  displayNamePlural?: string
                                  resourceType?: string
                                  currency?: string
                                  unit?: string
                                  overageRate?: number
                                  overageCap?: number
                                  overageEnabled?: boolean
                              }
                          }
                          subscription?: {
                              type?: string
                              title?: string
                              daysRemaining?: number
                              expiresAt?: number
                              overageCapability?: string
                              upgradeCapability?: string
                              subscriptionManagementTarget?: string
                          }
                          userInfo?: {
                              email?: string
                              userId?: string
                          }
                          status?: string
                          errorMessage?: string
                      }
                    | undefined
                // 检测封禁状态
                const newStatus =
                    refreshData?.status === 'error'
                        ? ('error' as AccountStatus)
                        : ('active' as AccountStatus)
                const newError = refreshData?.errorMessage
                // 后台刷新时主进程可能返回自动获取的 profileArn，持久化到顶层和 credentials
                const bgProfileArn =
                    refreshData?.profileArn || account.credentials.profileArn || account.profileArn
                accounts.set(id, {
                    ...account,
                    ...(bgProfileArn ? { profileArn: bgProfileArn } : {}),
                    credentials: {
                        ...account.credentials,
                        accessToken: refreshData?.accessToken || account.credentials.accessToken,
                        refreshToken: refreshData?.refreshToken || account.credentials.refreshToken,
                        expiresAt: refreshData?.expiresIn
                            ? now + refreshData.expiresIn * 1000
                            : account.credentials.expiresAt,
                        ...(bgProfileArn ? { profileArn: bgProfileArn } : {})
                    },
                    usage: refreshData?.usage
                        ? (() => {
                              const newCurrent = refreshData.usage.current ?? account.usage.current
                              const newLimit = refreshData.usage.limit ?? account.usage.limit
                              return {
                                  ...account.usage,
                                  current: newCurrent,
                                  limit: newLimit,
                                  percentUsed: newLimit > 0 ? newCurrent / newLimit : 0,
                                  baseCurrent:
                                      refreshData.usage.baseCurrent ?? account.usage.baseCurrent,
                                  baseLimit: refreshData.usage.baseLimit ?? account.usage.baseLimit,
                                  freeTrialCurrent:
                                      refreshData.usage.freeTrialCurrent ??
                                      account.usage.freeTrialCurrent,
                                  freeTrialLimit:
                                      refreshData.usage.freeTrialLimit ??
                                      account.usage.freeTrialLimit,
                                  freeTrialExpiry:
                                      refreshData.usage.freeTrialExpiry ??
                                      account.usage.freeTrialExpiry,
                                  bonuses: refreshData.usage.bonuses ?? account.usage.bonuses,
                                  nextResetDate:
                                      refreshData.usage.nextResetDate ??
                                      account.usage.nextResetDate,
                                  resourceDetail:
                                      refreshData.usage.resourceDetail ??
                                      account.usage.resourceDetail,
                                  lastUpdated: now
                              }
                          })()
                        : account.usage,
                    subscription: refreshData?.subscription
                        ? {
                              ...account.subscription,
                              type:
                                  (refreshData.subscription.type as SubscriptionType) ||
                                  account.subscription.type,
                              title: refreshData.subscription.title || account.subscription.title,
                              daysRemaining:
                                  refreshData.subscription.daysRemaining ??
                                  account.subscription.daysRemaining,
                              expiresAt:
                                  refreshData.subscription.expiresAt ??
                                  account.subscription.expiresAt,
                              overageCapability:
                                  refreshData.subscription.overageCapability ??
                                  account.subscription.overageCapability,
                              upgradeCapability:
                                  refreshData.subscription.upgradeCapability ??
                                  account.subscription.upgradeCapability,
                              managementTarget:
                                  refreshData.subscription.subscriptionManagementTarget ??
                                  account.subscription.managementTarget
                          }
                        : account.subscription,
                    email: refreshData?.userInfo?.email || account.email,
                    userId: refreshData?.userInfo?.userId || account.userId,
                    status: newStatus,
                    lastError: newError,
                    lastCheckedAt: now
                })
            } // end for-loop
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
    }
    function handleBackgroundCheckResult(data: {
        id: string
        success: boolean
        data?: unknown
        error?: string
    }): void {
        useAccountsStore(pinia).applyBackgroundCheckResults([data])
    }
    function applyBackgroundCheckResults(
        items: Array<{
            id: string
            success: boolean
            data?: unknown
            error?: string
        }>
    ): void {
        if (!items || items.length === 0) return
        {
            const state = {
                accounts: useAccountsStore(pinia).accounts
            }
            const accounts = new Map(state.accounts)
            const now = Date.now()
            for (const data of items) {
                const { id, success, data: resultData, error } = data
                const account = accounts.get(id)
                if (!account) continue
                if (!success) {
                    accounts.set(id, {
                        ...account,
                        status: 'error',
                        lastError: error,
                        lastCheckedAt: now
                    })
                    continue
                }
                const checkData = resultData as
                    | {
                          usage?: {
                              current?: number
                              limit?: number
                              baseCurrent?: number
                              baseLimit?: number
                              freeTrialCurrent?: number
                              freeTrialLimit?: number
                              freeTrialExpiry?: string
                              bonuses?: Array<{
                                  code: string
                                  name: string
                                  current: number
                                  limit: number
                                  expiresAt?: string
                              }>
                              nextResetDate?: string
                              resourceDetail?: {
                                  displayName?: string
                                  displayNamePlural?: string
                                  resourceType?: string
                                  currency?: string
                                  unit?: string
                                  overageRate?: number
                                  overageCap?: number
                                  overageEnabled?: boolean
                              }
                          }
                          subscription?: {
                              type?: string
                              title?: string
                              daysRemaining?: number
                              expiresAt?: number
                              overageCapability?: string
                              upgradeCapability?: string
                              subscriptionManagementTarget?: string
                          }
                          userInfo?: {
                              email?: string
                              userId?: string
                          }
                          status?: string
                          errorMessage?: string
                          needsRefresh?: boolean
                      }
                    | undefined
                // 检测状态
                let newStatus: AccountStatus = 'active'
                if (checkData?.status === 'error') {
                    newStatus = 'error'
                } else if (checkData?.status === 'expired' || checkData?.needsRefresh) {
                    newStatus = 'expired'
                }
                const newError = checkData?.errorMessage
                accounts.set(id, {
                    ...account,
                    usage: checkData?.usage
                        ? (() => {
                              const newCurrent = checkData.usage.current ?? account.usage.current
                              const newLimit = checkData.usage.limit ?? account.usage.limit
                              return {
                                  ...account.usage,
                                  current: newCurrent,
                                  limit: newLimit,
                                  percentUsed: newLimit > 0 ? newCurrent / newLimit : 0,
                                  baseCurrent:
                                      checkData.usage.baseCurrent ?? account.usage.baseCurrent,
                                  baseLimit: checkData.usage.baseLimit ?? account.usage.baseLimit,
                                  freeTrialCurrent:
                                      checkData.usage.freeTrialCurrent ??
                                      account.usage.freeTrialCurrent,
                                  freeTrialLimit:
                                      checkData.usage.freeTrialLimit ??
                                      account.usage.freeTrialLimit,
                                  freeTrialExpiry:
                                      checkData.usage.freeTrialExpiry ??
                                      account.usage.freeTrialExpiry,
                                  bonuses: checkData.usage.bonuses ?? account.usage.bonuses,
                                  nextResetDate:
                                      checkData.usage.nextResetDate ?? account.usage.nextResetDate,
                                  resourceDetail:
                                      checkData.usage.resourceDetail ??
                                      account.usage.resourceDetail,
                                  lastUpdated: now
                              }
                          })()
                        : account.usage,
                    subscription: checkData?.subscription
                        ? {
                              ...account.subscription,
                              type:
                                  (checkData.subscription.type as
                                      | 'Free'
                                      | 'Pro'
                                      | 'Enterprise'
                                      | 'Teams') ?? account.subscription.type,
                              title: checkData.subscription.title ?? account.subscription.title,
                              daysRemaining:
                                  checkData.subscription.daysRemaining ??
                                  account.subscription.daysRemaining,
                              expiresAt:
                                  checkData.subscription.expiresAt ??
                                  account.subscription.expiresAt,
                              overageCapability:
                                  checkData.subscription.overageCapability ??
                                  account.subscription.overageCapability,
                              upgradeCapability:
                                  checkData.subscription.upgradeCapability ??
                                  account.subscription.upgradeCapability,
                              managementTarget:
                                  checkData.subscription.subscriptionManagementTarget ??
                                  account.subscription.managementTarget
                          }
                        : account.subscription,
                    email: checkData?.userInfo?.email || account.email,
                    userId: checkData?.userInfo?.userId || account.userId,
                    status: newStatus,
                    lastError: newError,
                    lastCheckedAt: now
                })
            } // end for-loop
            const changes: {
                accounts: Map<string, Account>
            } = { accounts }
            useAccountsStore(pinia).$patch((state) => {
                state.accounts = changes.accounts
            })
        }
    }
    async function syncLocalSsoAccountAsync(isCurrent: () => boolean = () => true): Promise<void> {
        try {
            const localResult = await window.api.getLocalActiveAccount()
            if (!isCurrent()) return
            if (!localResult.success || !localResult.data?.refreshToken) return
            const localRefreshToken = localResult.data.refreshToken
            const currentAccounts = useAccountsStore(pinia).accounts
            // 查找匹配的账号
            let foundAccountId: string | null = null
            for (const [id, account] of currentAccounts) {
                if (account.credentials.refreshToken === localRefreshToken) {
                    foundAccountId = id
                    break
                }
            }
            if (foundAccountId) {
                {
                    const changes: {
                        activeAccountId: string | null
                    } = { activeAccountId: foundAccountId }
                    useAccountsStore(pinia).$patch((state) => {
                        state.activeAccountId = changes.activeAccountId
                    })
                }
                {
                    const state = {
                        accounts: useAccountsStore(pinia).accounts
                    }
                    const accounts = new Map(state.accounts)
                    for (const [id, account] of accounts) {
                        const shouldBeActive = id === foundAccountId
                        if (account.isActive !== shouldBeActive) {
                            accounts.set(id, { ...account, isActive: shouldBeActive })
                        }
                    }
                    const changes: {
                        accounts: Map<string, Account>
                    } = { accounts }
                    useAccountsStore(pinia).$patch((state) => {
                        state.accounts = changes.accounts
                    })
                }
                console.log('[Store] Synced active account from local SSO cache:', foundAccountId)
                usePersistenceStore(pinia).saveToStorage()
                return
            }
            // 未找到匹配账号，尝试自动导入（网络请求）
            console.log('[Store] Local account not found in app, importing...')
            const importResult = await window.api.loadKiroCredentials()
            if (!isCurrent()) return
            if (!importResult.success || !importResult.data) return
            const verifyResult = await window.api.verifyAccountCredentials(
                toIpcData({
                    refreshToken: importResult.data.refreshToken,
                    clientId: importResult.data.clientId || '',
                    clientSecret: importResult.data.clientSecret || '',
                    region: importResult.data.region,
                    authMethod: importResult.data.authMethod,
                    provider: importResult.data.provider
                })
            )
            if (!isCurrent()) return
            if (!verifyResult.success || !verifyResult.data) return
            const now = Date.now()
            const newId = `${verifyResult.data.email}-${now}`
            const newAccount: Account = {
                id: newId,
                email: verifyResult.data.email,
                userId: verifyResult.data.userId,
                nickname: verifyResult.data.email
                    ? verifyResult.data.email.split('@')[0]
                    : undefined,
                idp: (importResult.data.provider || 'BuilderId') as
                    | 'BuilderId'
                    | 'Google'
                    | 'Github',
                credentials: {
                    accessToken: verifyResult.data.accessToken,
                    csrfToken: '',
                    refreshToken: verifyResult.data.refreshToken,
                    clientId: importResult.data.clientId || '',
                    clientSecret: importResult.data.clientSecret || '',
                    region: importResult.data.region || 'us-east-1',
                    expiresAt: verifyResult.data.expiresIn
                        ? now + verifyResult.data.expiresIn * 1000
                        : now + 3600 * 1000,
                    authMethod: importResult.data.authMethod as 'IdC' | 'social',
                    provider: (importResult.data.provider || 'BuilderId') as
                        | 'BuilderId'
                        | 'Github'
                        | 'Google'
                },
                subscription: {
                    type: verifyResult.data.subscriptionType as SubscriptionType,
                    title: verifyResult.data.subscriptionTitle,
                    rawType: verifyResult.data.subscription?.rawType,
                    daysRemaining: verifyResult.data.daysRemaining,
                    expiresAt: verifyResult.data.expiresAt,
                    managementTarget: verifyResult.data.subscription?.managementTarget,
                    upgradeCapability: verifyResult.data.subscription?.upgradeCapability,
                    overageCapability: verifyResult.data.subscription?.overageCapability
                },
                usage: {
                    current: verifyResult.data.usage.current,
                    limit: verifyResult.data.usage.limit,
                    percentUsed:
                        verifyResult.data.usage.limit > 0
                            ? verifyResult.data.usage.current / verifyResult.data.usage.limit
                            : 0,
                    lastUpdated: now,
                    baseLimit: verifyResult.data.usage.baseLimit,
                    baseCurrent: verifyResult.data.usage.baseCurrent,
                    freeTrialLimit: verifyResult.data.usage.freeTrialLimit,
                    freeTrialCurrent: verifyResult.data.usage.freeTrialCurrent,
                    freeTrialExpiry: verifyResult.data.usage.freeTrialExpiry,
                    bonuses: verifyResult.data.usage.bonuses,
                    nextResetDate: verifyResult.data.usage.nextResetDate,
                    resourceDetail: verifyResult.data.usage.resourceDetail
                },
                status: 'active',
                createdAt: now,
                lastUsedAt: now,
                tags: [],
                isActive: true
            }
            {
                const state = {
                    accounts: useAccountsStore(pinia).accounts
                }
                const accounts = new Map(state.accounts)
                // 取消其它账号的激活状态
                for (const [id, account] of accounts) {
                    if (account.isActive) {
                        accounts.set(id, { ...account, isActive: false })
                    }
                }
                accounts.set(newId, newAccount)
                const changes: {
                    accounts: Map<string, Account>
                    activeAccountId: string | null
                } = { accounts, activeAccountId: newId }
                useAccountsStore(pinia).$patch((state) => {
                    state.accounts = changes.accounts
                    state.activeAccountId = changes.activeAccountId
                })
            }
            console.log(
                '[Store] Auto-imported account from local SSO cache:',
                verifyResult.data.email
            )
            usePersistenceStore(pinia).saveToStorage()
        } catch (e) {
            console.warn('[Store] Failed to sync local active account:', e)
        }
    }
    /** 触发 Webhook 事件（封装错误处理，不阻塞主业务流程） */
    function triggerWebhook(event: WebhookEvent, payload: WebhookMessage): void {
        try {
            void useWebhookStore(pinia).triggerEvent(event, payload)
        } catch (err) {
            console.warn(`[Webhook] trigger ${event} failed:`, err)
        }
    }

    return {
        accounts,
        groups,
        tags,
        activeAccountId,
        filter,
        activeGroupTab,
        sort,
        selectedIds,
        addAccount,
        updateAccount,
        removeAccount,
        removeAccounts,
        setActiveAccount,
        getActiveAccount,
        addGroup,
        updateGroup,
        removeGroup,
        moveAccountsToGroup,
        addTag,
        updateTag,
        removeTag,
        addTagToAccounts,
        removeTagFromAccounts,
        setFilter,
        clearFilter,
        setActiveGroupTab,
        setSort,
        filteredAccounts,
        getFilteredAccounts,
        selectAccount,
        deselectAccount,
        selectAll,
        deselectAll,
        toggleSelection,
        getSelectedAccounts,
        exportAccounts,
        importAccounts,
        importFromExportData,
        updateAccountStatus,
        refreshAccountToken,
        batchRefreshTokens,
        checkAccountStatus,
        batchCheckStatus,
        stats,
        getStats,
        checkAndRefreshExpiringTokens,
        refreshExpiredTokensOnly,
        startAutoTokenRefresh,
        stopAutoTokenRefresh,
        triggerBackgroundRefresh,
        handleBackgroundRefreshResult,
        applyBackgroundRefreshResults,
        handleBackgroundCheckResult,
        applyBackgroundCheckResults,
        syncLocalSsoAccountAsync
    }
})
