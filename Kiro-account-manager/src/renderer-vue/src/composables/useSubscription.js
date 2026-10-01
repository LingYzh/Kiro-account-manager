import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { toIpcData } from '../lib/ipcData'
import {
    checkUpgradeEligibility,
    isFreeForBatch,
    isSubscribed,
    overageArgs,
    parseImportedLinks,
    subscriptionAccountArgs,
    subscriptionUrlArgs
} from '../lib/subscription'

/** Pass the calling Pinia to this exported store when registering a link outside the page. */
export const useSubscriptionState = defineStore('kam-subscription', () => {
    const accountsStore = useAccountsStore()
    const activeTab = ref('overage')
    const links = ref([])
    const selectedLinkIds = ref(new Set())
    const availablePlans = ref([])
    const selectedPlanType = ref('')
    const overageItems = ref([])
    const quickPickCount = ref(10)
    const quickPickCursor = ref(0)
    const concurrency = ref(5)
    const deleteAlsoAccount = ref(false)
    const manageSelectedIds = ref(new Set())
    const isLoadingPlans = ref(false)
    const isFetching = ref(false)
    const isValidatingLinks = ref(false)
    const isSettingOverage = ref(false)
    const isBatchOpening = ref(false)
    const isBatchDisablingOverage = ref(false)
    const busyLinkIds = ref(new Set())
    const error = ref('')
    const feedback = ref('')
    let pageActive = false
    let generation = 0
    let linksEpoch = 0
    const portalDelays = new Set()

    const sourceAccounts = computed(() =>
        accountsStore.selectedIds.size
            ? Array.from(accountsStore.selectedIds)
                  .map((id) => accountsStore.accounts.get(id))
                  .filter(Boolean)
            : Array.from(accountsStore.accounts.values())
    )
    const upgradeableAccounts = computed(() => sourceAccounts.value.filter(isFreeForBatch))
    const subscribedAccounts = computed(() => sourceAccounts.value.filter(isSubscribed))
    const overageableAccounts = computed(() =>
        subscribedAccounts.value.filter(
            (account) =>
                account.subscription?.overageCapability === 'OVERAGE_CAPABLE' &&
                account.usage?.resourceDetail?.overageEnabled !== true
        )
    )
    const preflightReport = computed(() => {
        const eligible = []
        const blocked = []
        const reasonBuckets = {
            ok: 0,
            'no-token': 0,
            'already-pro': 0,
            banned: 0,
            'cant-upgrade': 0,
            'unknown-status': 0
        }
        for (const account of sourceAccounts.value) {
            const result = checkUpgradeEligibility(account)
            if (result.eligible) eligible.push(account)
            else blocked.push({ account, reason: result.reason, detail: result.detail })
            reasonBuckets[result.reason] += 1
        }
        return { eligible, blocked, reasonBuckets, totalScanned: sourceAccounts.value.length }
    })
    const targetSuccessLinks = computed(() =>
        links.value.filter((link) => link.status === 'success' && link.url)
    )
    const selectedCount = computed(() => selectedLinkIds.value.size)

    function beginPage() {
        pageActive = true
        generation += 1
    }
    function disposePage() {
        pageActive = false
        generation += 1
        linksEpoch += 1
        isLoadingPlans.value = false
        isFetching.value = false
        isValidatingLinks.value = false
        isSettingOverage.value = false
        isBatchOpening.value = false
        isBatchDisablingOverage.value = false
        busyLinkIds.value = new Set()
        for (const delay of portalDelays) {
            clearTimeout(delay.timer)
            delay.resolve()
        }
        portalDelays.clear()
    }
    function live(current) {
        return pageActive && current === generation
    }
    function setError(cause) {
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
    function appendLink(link) {
        links.value = [...links.value, toIpcData(link)]
    }
    function updateLink(accountId, update) {
        links.value = links.value.map((link) =>
            link.accountId === accountId ? { ...link, ...toIpcData(update) } : link
        )
    }
    function updateExistingLink(accountId, update, predicate = () => true) {
        links.value = links.value.map((link) =>
            link.accountId === accountId && predicate(link) ? { ...link, ...update } : link
        )
    }
    function setLinkBusy(id, busy) {
        const next = new Set(busyLinkIds.value)
        if (busy) next.add(id)
        else next.delete(id)
        busyLinkIds.value = next
    }
    function setSelection(next) {
        selectedLinkIds.value = new Set(next)
    }
    function toggleLinkSelection(id) {
        const next = new Set(selectedLinkIds.value)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelection(next)
    }
    function toggleSelectAllLinks() {
        setSelection(
            selectedLinkIds.value.size === links.value.length && links.value.length > 0
                ? []
                : links.value.map((link) => link.accountId)
        )
    }
    function invertLinkSelection() {
        setSelection(
            links.value
                .filter((link) => !selectedLinkIds.value.has(link.accountId))
                .map((link) => link.accountId)
        )
    }
    function clearLinkSelection() {
        setSelection([])
    }
    function selectByStatus(status) {
        setSelection([
            ...selectedLinkIds.value,
            ...links.value.filter((link) => link.status === status).map((link) => link.accountId)
        ])
    }
    function quickPickTop() {
        const picked = targetSuccessLinks.value.slice(
            0,
            Math.max(1, Number(quickPickCount.value) || 1)
        )
        setSelection(picked.map((link) => link.accountId))
        quickPickCursor.value = picked.length
    }
    function quickPickNext() {
        const success = targetSuccessLinks.value
        if (!success.length) return
        const start = quickPickCursor.value >= success.length ? 0 : quickPickCursor.value
        const picked = success.slice(start, start + Math.max(1, Number(quickPickCount.value) || 1))
        setSelection(picked.map((link) => link.accountId))
        quickPickCursor.value = start + picked.length
    }
    function importLinks(text, isEn) {
        const parsed = parseImportedLinks(text)
        const existing = new Set(links.value.map((link) => link.url).filter(Boolean))
        const added = []
        let sequence = links.value.length
        const now = Date.now()
        for (const { email, url } of parsed) {
            if (existing.has(url)) continue
            existing.add(url)
            sequence += 1
            added.push({
                accountId: `import-${crypto.randomUUID()}`,
                email: email || (isEn ? `(Imported #${sequence})` : `(导入 #${sequence})`),
                status: 'success',
                url,
                generatedAt: now,
                validated: false
            })
        }
        if (added.length) links.value = [...links.value, ...added]
        return added.length
    }
    function deleteSelectedLinks() {
        const ids = selectedLinkIds.value
        links.value = links.value.filter((link) => !ids.has(link.accountId))
        setSelection([])
    }
    function clearLinks() {
        linksEpoch += 1
        links.value = []
        setSelection([])
        isFetching.value = false
        isValidatingLinks.value = false
    }
    function clearOverageItems(failedOnly = false) {
        overageItems.value = failedOnly
            ? overageItems.value.filter((item) => item.status !== 'error')
            : []
    }
    function deleteFailedLinks(withAccounts = false) {
        const removed = links.value
            .filter((link) => link.status === 'error' || link.status === 'expired')
            .map((link) => link.accountId)
        if (withAccounts) for (const id of removed) accountsStore.removeAccount(id)
        const ids = new Set(removed)
        links.value = links.value.filter((link) => !ids.has(link.accountId))
        setSelection([...selectedLinkIds.value].filter((id) => !ids.has(id)))
        return removed.length
    }
    function getTargetLinks(mode) {
        return targetSuccessLinks.value.filter(
            (link) => mode !== 'selected' || selectedLinkIds.value.has(link.accountId)
        )
    }

    async function loadPlans() {
        if (isLoadingPlans.value || !upgradeableAccounts.value.length || !pageActive) return
        const current = generation
        isLoadingPlans.value = true
        error.value = ''
        try {
            const result = await window.api.accountGetSubscriptions(
                ...subscriptionAccountArgs(upgradeableAccounts.value[0])
            )
            if (!live(current)) return
            if (!result.success || !result.plans?.length)
                throw new Error(result.error || 'No subscription plans available')
            availablePlans.value = result.plans
            const preferred =
                result.plans.find(
                    (plan) =>
                        plan.qSubscriptionType?.toUpperCase().includes('PRO') &&
                        !plan.qSubscriptionType?.toUpperCase().includes('PLUS')
                ) || result.plans[0]
            selectedPlanType.value = preferred.qSubscriptionType
        } catch (cause) {
            if (live(current)) setError(cause)
        } finally {
            if (live(current)) isLoadingPlans.value = false
        }
    }

    async function batchFetchLinks() {
        if (
            isFetching.value ||
            isValidatingLinks.value ||
            !selectedPlanType.value ||
            !upgradeableAccounts.value.length ||
            !pageActive
        )
            return
        const current = generation
        const epoch = ++linksEpoch
        const targets = [...upgradeableAccounts.value]
        const planType = selectedPlanType.value
        isFetching.value = true
        error.value = ''
        links.value = targets.map((account) => ({
            accountId: account.id,
            email: account.email || 'Unknown',
            status: 'pending'
        }))
        setSelection([])
        let cursor = 0
        async function worker() {
            while (live(current) && epoch === linksEpoch && cursor < targets.length) {
                const account = targets[cursor++]
                updateExistingLink(account.id, { status: 'loading' })
                try {
                    const result = await window.api.accountGetSubscriptionUrl(
                        ...subscriptionUrlArgs(account, planType)
                    )
                    if (!live(current) || epoch !== linksEpoch) return
                    updateExistingLink(
                        account.id,
                        result.success && result.url
                            ? {
                                  status: 'success',
                                  url: result.url,
                                  generatedAt: Date.now(),
                                  validated: false,
                                  error: undefined
                              }
                            : { status: 'error', error: result.error || 'Failed to get URL' }
                    )
                } catch (cause) {
                    if (!live(current) || epoch !== linksEpoch) return
                    updateExistingLink(account.id, {
                        status: 'error',
                        error: cause instanceof Error ? cause.message : 'Unknown error'
                    })
                }
            }
        }
        await Promise.all(
            Array.from(
                { length: Math.min(Math.max(1, Number(concurrency.value) || 1), targets.length) },
                () => worker()
            )
        )
        if (live(current) && epoch === linksEpoch) isFetching.value = false
    }

    async function regenerateLink(accountId) {
        if (!selectedPlanType.value || busyLinkIds.value.has(accountId) || !pageActive) return
        const account = accountsStore.accounts.get(accountId)
        if (!account?.credentials?.accessToken) return
        const existing = links.value.find((link) => link.accountId === accountId)
        if (!existing) return
        const current = generation
        const epoch = linksEpoch
        setLinkBusy(accountId, true)
        updateExistingLink(accountId, { status: 'loading', error: undefined })
        try {
            const result = await window.api.accountGetSubscriptionUrl(
                ...subscriptionUrlArgs(account, selectedPlanType.value)
            )
            if (!live(current) || epoch !== linksEpoch) return
            updateExistingLink(
                accountId,
                result.success && result.url
                    ? {
                          status: 'success',
                          url: result.url,
                          generatedAt: Date.now(),
                          validated: false,
                          error: undefined
                      }
                    : { status: 'error', error: result.error || 'Failed' }
            )
        } catch (cause) {
            if (live(current) && epoch === linksEpoch)
                updateExistingLink(accountId, {
                    status: 'error',
                    error: cause instanceof Error ? cause.message : 'Unknown error'
                })
        } finally {
            if (live(current)) setLinkBusy(accountId, false)
        }
    }

    async function validateLinks() {
        if (isValidatingLinks.value || isFetching.value || !pageActive) return
        const current = generation
        const epoch = linksEpoch
        const targets = links.value
            .filter((link) => link.status === 'success' && link.url)
            .map((link) => ({ ...link }))
        isValidatingLinks.value = true
        error.value = ''
        const now = Date.now()
        const old = targets.filter(
            (link) => !link.generatedAt || now - link.generatedAt > 15 * 60 * 1000
        )
        for (const link of old)
            updateExistingLink(
                link.accountId,
                { status: 'expired', error: '链接已失效（HTTP 探测失败或超过 15 分钟）' },
                (item) =>
                    item.status === 'success' &&
                    item.url === link.url &&
                    item.generatedAt === link.generatedAt
            )
        const probe = targets.filter((link) => !old.includes(link))
        let cursor = 0
        async function worker() {
            while (live(current) && epoch === linksEpoch && cursor < probe.length) {
                const link = probe[cursor++]
                try {
                    const result = await window.api.diagnoseHttpProbe(
                        toIpcData({ url: link.url, method: 'HEAD', timeoutMs: 6000 })
                    )
                    if (!live(current) || epoch !== linksEpoch) return
                    updateExistingLink(
                        link.accountId,
                        result.success || (result.status !== undefined && result.status < 400)
                            ? { validated: true }
                            : {
                                  status: 'expired',
                                  error: '链接已失效（HTTP 探测失败或超过 15 分钟）'
                              },
                        (item) =>
                            item.status === 'success' &&
                            item.url === link.url &&
                            item.generatedAt === link.generatedAt
                    )
                } catch {
                    if (!live(current) || epoch !== linksEpoch) return
                    updateExistingLink(
                        link.accountId,
                        { status: 'expired', error: '链接已失效（HTTP 探测失败或超过 15 分钟）' },
                        (item) =>
                            item.status === 'success' &&
                            item.url === link.url &&
                            item.generatedAt === link.generatedAt
                    )
                }
            }
        }
        await Promise.all(
            Array.from(
                { length: Math.min(Math.max(1, Number(concurrency.value) || 1), probe.length) },
                () => worker()
            )
        )
        if (live(current) && epoch === linksEpoch) isValidatingLinks.value = false
    }

    async function openLink(url) {
        if (!pageActive) return
        const result = await window.api.openSubscriptionWindow(url)
        if (!result.success) throw new Error(result.error || 'Could not open subscription window')
    }
    async function openLinks(mode) {
        if (!pageActive) return
        await Promise.all(getTargetLinks(mode).map((link) => openLink(link.url)))
    }
    async function copyLink(url) {
        await navigator.clipboard.writeText(url)
    }
    async function exportLinks(mode) {
        await navigator.clipboard.writeText(
            getTargetLinks(mode)
                .map((link) => link.url)
                .join('\n')
        )
    }

    async function batchSetOverage(customTargets) {
        if (isSettingOverage.value || isBatchDisablingOverage.value || !pageActive) return
        const targets = customTargets || overageableAccounts.value
        if (!targets.length) return
        const current = generation
        isSettingOverage.value = true
        error.value = ''
        overageItems.value = targets.map((account) => ({
            accountId: account.id,
            email: account.email || 'Unknown',
            status: 'pending'
        }))
        let cursor = 0
        async function worker() {
            while (live(current) && cursor < targets.length) {
                const account = targets[cursor++]
                overageItems.value = overageItems.value.map((item) =>
                    item.accountId === account.id ? { ...item, status: 'loading' } : item
                )
                try {
                    const result = await window.api.accountSetOverage(
                        ...overageArgs(account, 'ENABLED')
                    )
                    if (!live(current)) return
                    overageItems.value = overageItems.value.map((item) =>
                        item.accountId === account.id
                            ? result.success
                                ? { ...item, status: 'success' }
                                : {
                                      ...item,
                                      status: 'error',
                                      error: result.error || 'Unknown error'
                                  }
                            : item
                    )
                    if (result.success) updateOverageAccount(account.id, true)
                } catch (cause) {
                    if (!live(current)) return
                    overageItems.value = overageItems.value.map((item) =>
                        item.accountId === account.id
                            ? {
                                  ...item,
                                  status: 'error',
                                  error: cause instanceof Error ? cause.message : 'Unknown error'
                              }
                            : item
                    )
                }
            }
        }
        await Promise.all(
            Array.from(
                { length: Math.min(Math.max(1, Number(concurrency.value) || 1), targets.length) },
                () => worker()
            )
        )
        if (live(current)) isSettingOverage.value = false
    }
    function updateOverageAccount(id, enabled) {
        const existing = accountsStore.accounts.get(id)
        if (!existing) return
        accountsStore.updateAccount(id, {
            usage: {
                ...existing.usage,
                resourceDetail: { ...existing.usage?.resourceDetail, overageEnabled: enabled }
            }
        })
    }
    function toggleManageSelection(id) {
        const next = new Set(manageSelectedIds.value)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        manageSelectedIds.value = next
    }
    function toggleManageAll() {
        manageSelectedIds.value =
            manageSelectedIds.value.size === subscribedAccounts.value.length
                ? new Set()
                : new Set(subscribedAccounts.value.map((account) => account.id))
    }
    function manageTargets(mode) {
        return subscribedAccounts.value.filter(
            (account) => mode !== 'selected' || manageSelectedIds.value.has(account.id)
        )
    }
    async function openPortalForAccount(account) {
        if (!pageActive || busyLinkIds.value.has(account.id)) return
        const current = generation
        setLinkBusy(account.id, true)
        try {
            const result = await window.api.accountGetSubscriptionUrl(
                ...subscriptionUrlArgs(account, undefined)
            )
            if (!live(current)) return
            if (!result.success || !result.url)
                throw new Error(result.error || 'Could not get subscription portal')
            await openLink(result.url)
        } finally {
            if (live(current)) setLinkBusy(account.id, false)
        }
    }
    async function batchOpenPortals(mode) {
        if (isBatchOpening.value || !pageActive) return
        const targets = manageTargets(mode)
        if (!targets.length) return
        const current = generation
        isBatchOpening.value = true
        error.value = ''
        let cursor = 0
        async function worker() {
            while (live(current) && cursor < targets.length) {
                const account = targets[cursor++]
                try {
                    const result = await window.api.accountGetSubscriptionUrl(
                        ...subscriptionUrlArgs(account, undefined)
                    )
                    if (!live(current)) return
                    if (result.success && result.url) {
                        await openLink(result.url)
                        if (!live(current)) return
                        await new Promise((resolve) => {
                            const delay = { timer: undefined, resolve }
                            delay.timer = setTimeout(() => {
                                portalDelays.delete(delay)
                                resolve()
                            }, 500)
                            portalDelays.add(delay)
                        })
                    } else if (!result.success) feedback.value = result.error || ''
                } catch (cause) {
                    if (live(current)) setError(cause)
                }
            }
        }
        await Promise.all(
            Array.from(
                { length: Math.min(Math.max(1, Number(concurrency.value) || 1), targets.length) },
                () => worker()
            )
        )
        if (live(current)) isBatchOpening.value = false
    }
    async function batchDisableOverage(mode) {
        if (isBatchDisablingOverage.value || isSettingOverage.value || !pageActive) return
        const targets = manageTargets(mode).filter(
            (account) => account.usage?.resourceDetail?.overageEnabled === true
        )
        if (!targets.length) return
        const current = generation
        isBatchDisablingOverage.value = true
        error.value = ''
        let cursor = 0
        async function worker() {
            while (live(current) && cursor < targets.length) {
                const account = targets[cursor++]
                try {
                    const result = await window.api.accountSetOverage(
                        ...overageArgs(account, 'DISABLED')
                    )
                    if (!live(current)) return
                    if (result.success) updateOverageAccount(account.id, false)
                    else feedback.value = result.error || ''
                } catch (cause) {
                    if (live(current)) setError(cause)
                }
            }
        }
        await Promise.all(
            Array.from(
                { length: Math.min(Math.max(1, Number(concurrency.value) || 1), targets.length) },
                () => worker()
            )
        )
        if (live(current)) isBatchDisablingOverage.value = false
    }

    return {
        activeTab,
        links,
        selectedLinkIds,
        availablePlans,
        selectedPlanType,
        overageItems,
        quickPickCount,
        quickPickCursor,
        concurrency,
        deleteAlsoAccount,
        manageSelectedIds,
        isLoadingPlans,
        isFetching,
        isValidatingLinks,
        isSettingOverage,
        isBatchOpening,
        isBatchDisablingOverage,
        busyLinkIds,
        error,
        feedback,
        sourceAccounts,
        upgradeableAccounts,
        subscribedAccounts,
        overageableAccounts,
        preflightReport,
        targetSuccessLinks,
        selectedCount,
        beginPage,
        disposePage,
        appendLink,
        updateLink,
        toggleLinkSelection,
        toggleSelectAllLinks,
        invertLinkSelection,
        clearLinkSelection,
        selectByStatus,
        quickPickTop,
        quickPickNext,
        importLinks,
        deleteSelectedLinks,
        deleteFailedLinks,
        clearLinks,
        clearOverageItems,
        getTargetLinks,
        loadPlans,
        batchFetchLinks,
        regenerateLink,
        validateLinks,
        openLink,
        openLinks,
        copyLink,
        exportLinks,
        batchSetOverage,
        toggleManageSelection,
        toggleManageAll,
        manageTargets,
        openPortalForAccount,
        batchOpenPortals,
        batchDisableOverage
    }
})
