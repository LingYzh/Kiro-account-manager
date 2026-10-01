<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { UiBadge, UiButton, UiCard, UiField, UiInput } from '@lingyzh/ui'
import { toRgba } from '@shared/lib/accountHelpers'
import { useAccountsStore } from '../../stores/accounts'
import { useTranslation } from '../../composables/useTranslation'

const DOMAIN_DISPLAY_LIMIT = 16
const subscriptionOptions = [
    { value: 'Free', label: 'KIRO FREE' },
    { value: 'Pro', label: 'KIRO PRO' },
    { value: 'Pro_Plus', label: 'KIRO PRO+' },
    { value: 'Enterprise', label: 'KIRO POWER' }
]
const statusOptions = [
    { value: 'active', zh: '正常', en: 'Active' },
    { value: 'expired', zh: '已过期', en: 'Expired' },
    { value: 'error', zh: '错误', en: 'Error' },
    { value: 'unknown', zh: '未知', en: 'Unknown' }
]
const idpOptions = [
    { value: 'Google', label: 'Google' },
    { value: 'Github', label: 'GitHub' },
    { value: 'BuilderId', label: 'BuilderId' },
    { value: 'Enterprise', label: 'Enterprise' },
    { value: 'AWSIdC', label: 'AWSIdC' }
]

const accountsStore = useAccountsStore()
const { accounts, filter, tags } = storeToRefs(accountsStore)
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const stats = computed(() => accountsStore.getStats())
const showAllDomains = ref(false)

const domainCounts = computed(() => {
    const counts = new Map()
    for (const account of accounts.value.values()) {
        const atIndex = account.email.lastIndexOf('@')
        if (atIndex < 0) continue
        const domain = account.email.slice(atIndex + 1).toLowerCase()
        if (!domain) continue
        counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
})

const visibleDomains = computed(() => {
    if (showAllDomains.value || domainCounts.value.length <= DOMAIN_DISPLAY_LIMIT)
        return domainCounts.value
    const top = domainCounts.value.slice(0, DOMAIN_DISPLAY_LIMIT)
    const selected = new Set(filter.value.emailDomains ?? [])
    for (const entry of domainCounts.value.slice(DOMAIN_DISPLAY_LIMIT)) {
        if (selected.has(entry[0])) top.push(entry)
    }
    return top
})

const hasActiveFilters = computed(() =>
    Boolean(
        filter.value.subscriptionTypes?.length ||
        filter.value.statuses?.length ||
        filter.value.idps?.length ||
        filter.value.groupIds?.length ||
        filter.value.tagIds?.length ||
        filter.value.emailDomains?.length ||
        filter.value.usageMin !== undefined ||
        filter.value.usageMax !== undefined ||
        filter.value.daysRemainingMin !== undefined ||
        filter.value.daysRemainingMax !== undefined ||
        filter.value.bannedOnly
    )
)

function text(zh, en) {
    return isEn.value ? en : zh
}

function updateFilter(patch) {
    accountsStore.setFilter({ ...accountsStore.filter, ...patch })
}

function toggleArrayFilter(key, value) {
    const current = filter.value[key] ?? []
    const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    updateFilter({ [key]: next.length ? next : undefined })
}

function setRangeFilter(key, value, percent = false) {
    updateFilter({
        [key]:
            value === null || value === ''
                ? undefined
                : percent
                  ? Number(value) / 100
                  : Number(value)
    })
}

function clearFilters() {
    accountsStore.clearFilter()
}
</script>

<template>
    <UiCard density="compact" data-testid="account-filter">
        <div class="account-filter-content">
            <div v-if="hasActiveFilters" class="kam-actions account-filter-clear">
                <UiButton
                    variant="ghost"
                    size="sm"
                    data-testid="filter-clear"
                    @click="clearFilters"
                    >{{ text('清除筛选', 'Clear') }}</UiButton
                >
            </div>
            <section class="account-filter-section">
                <span class="kam-muted account-filter-label">{{ text('订阅', 'Plan') }}</span>
                <div class="kam-actions">
                    <UiButton
                        v-for="option in subscriptionOptions"
                        :key="option.value"
                        :variant="
                            filter.subscriptionTypes?.includes(option.value) ? 'secondary' : 'ghost'
                        "
                        size="sm"
                        :aria-pressed="Boolean(filter.subscriptionTypes?.includes(option.value))"
                        :data-testid="`filter-subscription-${option.value}`"
                        @click="toggleArrayFilter('subscriptionTypes', option.value)"
                    >
                        {{ option.label }}
                        <UiBadge dense>{{ stats.bySubscription[option.value] }}</UiBadge>
                    </UiButton>
                </div>
            </section>
            <section class="account-filter-section">
                <span class="kam-muted account-filter-label">{{ text('状态', 'Status') }}</span>
                <div class="kam-actions">
                    <UiButton
                        v-for="option in statusOptions"
                        :key="option.value"
                        :variant="filter.statuses?.includes(option.value) ? 'secondary' : 'ghost'"
                        size="sm"
                        :aria-pressed="Boolean(filter.statuses?.includes(option.value))"
                        :data-testid="`filter-status-${option.value}`"
                        @click="toggleArrayFilter('statuses', option.value)"
                    >
                        {{ text(option.zh, option.en) }}
                        <UiBadge dense>{{ stats.byStatus[option.value] }}</UiBadge>
                    </UiButton>
                    <UiButton
                        :variant="filter.bannedOnly ? 'secondary' : 'ghost'"
                        size="sm"
                        :aria-pressed="Boolean(filter.bannedOnly)"
                        data-testid="filter-banned"
                        @click="updateFilter({ bannedOnly: !filter.bannedOnly })"
                    >
                        {{ text('已封禁', 'Banned') }}
                        <UiBadge dense>{{ stats.bannedCount }}</UiBadge>
                    </UiButton>
                </div>
            </section>
            <section class="account-filter-section">
                <span class="kam-muted account-filter-label">IDP</span>
                <div class="kam-actions">
                    <UiButton
                        v-for="option in idpOptions"
                        :key="option.value"
                        :variant="filter.idps?.includes(option.value) ? 'secondary' : 'ghost'"
                        size="sm"
                        :aria-pressed="Boolean(filter.idps?.includes(option.value))"
                        :data-testid="`filter-idp-${option.value}`"
                        @click="toggleArrayFilter('idps', option.value)"
                    >
                        {{ option.label }} <UiBadge dense>{{ stats.byIdp[option.value] }}</UiBadge>
                    </UiButton>
                </div>
            </section>
            <section v-if="tags.size" class="account-filter-section">
                <span class="kam-muted account-filter-label">{{ text('标签', 'Tags') }}</span>
                <div class="kam-actions">
                    <UiButton
                        v-for="tag in tags.values()"
                        :key="tag.id"
                        :variant="filter.tagIds?.includes(tag.id) ? 'secondary' : 'ghost'"
                        size="sm"
                        :aria-pressed="Boolean(filter.tagIds?.includes(tag.id))"
                        :data-testid="`filter-tag-${tag.id}`"
                        @click="toggleArrayFilter('tagIds', tag.id)"
                    >
                        <UiBadge dense :color="toRgba(tag.color)">{{ tag.name }}</UiBadge>
                    </UiButton>
                </div>
            </section>
            <div class="account-filter-ranges">
                <UiField :label="text('使用量范围 (%)', 'Usage range (%)')">
                    <div class="account-filter-range">
                        <UiInput
                            type="number"
                            min="0"
                            max="100"
                            :model-value="
                                filter.usageMin === undefined ? null : filter.usageMin * 100
                            "
                            :aria-label="text('最低使用量', 'Minimum usage')"
                            placeholder="min"
                            data-testid="filter-usage-min"
                            @update:model-value="setRangeFilter('usageMin', $event, true)"
                        />
                        <span class="kam-muted">–</span>
                        <UiInput
                            type="number"
                            min="0"
                            max="100"
                            :model-value="
                                filter.usageMax === undefined ? null : filter.usageMax * 100
                            "
                            :aria-label="text('最高使用量', 'Maximum usage')"
                            placeholder="max"
                            data-testid="filter-usage-max"
                            @update:model-value="setRangeFilter('usageMax', $event, true)"
                        />
                    </div>
                </UiField>
                <UiField :label="text('剩余天数范围', 'Remaining days range')">
                    <div class="account-filter-range">
                        <UiInput
                            type="number"
                            min="0"
                            :model-value="filter.daysRemainingMin ?? null"
                            :aria-label="text('最少剩余天数', 'Minimum days')"
                            placeholder="min"
                            data-testid="filter-days-min"
                            @update:model-value="setRangeFilter('daysRemainingMin', $event)"
                        />
                        <span class="kam-muted">–</span>
                        <UiInput
                            type="number"
                            min="0"
                            :model-value="filter.daysRemainingMax ?? null"
                            :aria-label="text('最多剩余天数', 'Maximum days')"
                            placeholder="max"
                            data-testid="filter-days-max"
                            @update:model-value="setRangeFilter('daysRemainingMax', $event)"
                        />
                    </div>
                </UiField>
            </div>
            <section v-if="domainCounts.length" class="account-filter-section">
                <span class="kam-muted account-filter-label">{{ text('域名', 'Domain') }}</span>
                <div class="kam-actions">
                    <UiButton
                        v-for="[domain, count] in visibleDomains"
                        :key="domain"
                        :variant="filter.emailDomains?.includes(domain) ? 'secondary' : 'ghost'"
                        size="sm"
                        :aria-pressed="Boolean(filter.emailDomains?.includes(domain))"
                        :data-testid="`filter-domain-${domain}`"
                        @click="toggleArrayFilter('emailDomains', domain)"
                    >
                        @{{ domain }} <UiBadge dense>{{ count }}</UiBadge>
                    </UiButton>
                    <UiButton
                        v-if="domainCounts.length > DOMAIN_DISPLAY_LIMIT"
                        variant="ghost"
                        size="sm"
                        data-testid="filter-domains-expand"
                        @click="showAllDomains = !showAllDomains"
                    >
                        {{
                            showAllDomains
                                ? text('收起', 'Less')
                                : `+${domainCounts.length - DOMAIN_DISPLAY_LIMIT}`
                        }}
                    </UiButton>
                </div>
            </section>
        </div>
    </UiCard>
</template>

<style scoped>
.account-filter-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.account-filter-clear {
    justify-content: flex-end;
}
.account-filter-section {
    display: flex;
    align-items: flex-start;
    gap: 12px;
}
.account-filter-label {
    min-width: 48px;
    padding-top: 5px;
    font-size: 12px;
}
.account-filter-ranges {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
}
.account-filter-range {
    display: flex;
    align-items: center;
    gap: 8px;
}
.account-filter-range :deep(.ui-input) {
    width: 76px;
}
@media (max-width: 600px) {
    .account-filter-section {
        flex-direction: column;
        gap: 4px;
    }
}
</style>
