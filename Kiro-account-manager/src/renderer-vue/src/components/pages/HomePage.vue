<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { UiAlert, UiBadge, UiButton, UiCard, UiProgress } from '@lingyzh/ui'
import {
    Activity,
    AlertTriangle,
    Ban,
    CheckCircle,
    ChevronRight,
    Clock,
    Fingerprint,
    FolderPlus,
    Shield,
    Tag,
    TrendingUp,
    Users,
    Zap
} from 'lucide-vue-next'
import kiroLogo from '@shared/assets/kam-logo.png'
import { useAccountsStore } from '../../stores/accounts'
import { useSettingsStore } from '../../stores/settings'
import { useTranslation } from '../../composables/useTranslation'
import { isBannedAccountError } from '../../lib/accountRuntime'

const QUOTA_WARN_RATIO = 0.9
const EXPIRE_WARN_DAYS = 7

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()
const { accounts, activeAccountId } = storeToRefs(accountsStore)
const { usagePrecision } = storeToRefs(settingsStore)
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const stats = computed(() => accountsStore.getStats())
const activeAccount = computed(() =>
    activeAccountId.value ? (accounts.value.get(activeAccountId.value) ?? null) : null
)
const precision = computed(() => (usagePrecision.value ? 2 : 1))

const warnings = computed(() => {
    const banned = []
    const expiring = []
    const quotaHigh = []
    for (const account of accounts.value.values()) {
        if (isBannedAccountError(account.lastError)) {
            banned.push(account)
            continue
        }
        const days = account.subscription.daysRemaining
        if (days !== undefined && days <= EXPIRE_WARN_DAYS) expiring.push(account)
        if (
            account.status === 'active' &&
            account.usage.limit > 0 &&
            account.usage.percentUsed >= QUOTA_WARN_RATIO
        ) {
            quotaHigh.push(account)
        }
    }
    return { banned, expiring, quotaHigh }
})

const usageStats = computed(() => {
    let totalLimit = 0
    let totalUsed = 0
    let validAccountCount = 0
    for (const account of accounts.value.values()) {
        if (account.status === 'active' && account.usage) {
            const limit = account.usage.limit ?? 0
            const used = account.usage.current ?? 0
            if (limit > 0) {
                totalLimit += limit
                totalUsed += used
                validAccountCount++
            }
        }
    }
    return {
        totalLimit,
        totalUsed,
        remaining: totalLimit - totalUsed,
        percentUsed: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0,
        validAccountCount
    }
})

const statCards = computed(() => [
    {
        key: 'total',
        label: text('总账号数', 'Total Accounts'),
        value: stats.value.total,
        icon: Users
    },
    {
        key: 'active',
        label: text('正常账号', 'Active'),
        value: stats.value.byStatus?.active || 0,
        icon: CheckCircle
    },
    {
        key: 'error',
        label: text('已封禁', 'Banned'),
        value: stats.value.byStatus?.error || 0,
        icon: AlertTriangle
    },
    {
        key: 'expiring',
        label: text('即将过期', 'Expiring Soon'),
        value: stats.value.expiringSoonCount,
        icon: Clock
    }
])

const warningRows = computed(() =>
    [
        {
            key: 'banned',
            list: warnings.value.banned,
            icon: Ban,
            label: text('已封禁', 'Banned'),
            hint: text('需人工解封', 'Need manual unban'),
            filter: { bannedOnly: true }
        },
        {
            key: 'expiring',
            list: warnings.value.expiring,
            icon: Clock,
            label: text(`即将到期 (≤${EXPIRE_WARN_DAYS}天)`, `Expiring (≤${EXPIRE_WARN_DAYS}d)`),
            hint: text('尽快续期', 'Renew soon'),
            filter: { daysRemainingMax: EXPIRE_WARN_DAYS }
        },
        {
            key: 'quota',
            list: warnings.value.quotaHigh,
            icon: Zap,
            label: text('额度告急 (≥90%)', 'Quota ≥90%'),
            hint: text('即将耗尽', 'Almost exhausted'),
            filter: { usageMin: QUOTA_WARN_RATIO }
        }
    ].filter((row) => row.list.length > 0)
)

const overQuota = computed(() => usageStats.value.percentUsed > 100)
const overPercent = computed(() => (overQuota.value ? usageStats.value.percentUsed - 100 : 0))
const overAmount = computed(() => (overQuota.value ? Math.abs(usageStats.value.remaining) : 0))

const features = [
    {
        key: 'machine',
        icon: Fingerprint,
        zh: '机器码管理',
        en: 'Machine ID',
        detailZh: '修改设备标识符，切号时自动更换，支持账户绑定',
        detailEn: 'Modify device ID, auto-switch, account binding'
    },
    {
        key: 'groups',
        icon: FolderPlus,
        zh: '分组管理',
        en: 'Groups',
        detailZh: '多选账户后可批量设置分组，一键移动账号',
        detailEn: 'Batch set groups for selected accounts'
    },
    {
        key: 'tags',
        icon: Tag,
        zh: '标签管理',
        en: 'Tags',
        detailZh: '多选账户后可批量添加/移除标签，支持多标签',
        detailEn: 'Batch add/remove tags, multi-tag support'
    }
]

function text(zh, en) {
    return isEn.value ? en : zh
}

function jumpToAccounts(filter) {
    accountsStore.setActiveGroupTab('all')
    accountsStore.setFilter(filter)
    window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'accounts' }))
}

function warningPreview(row) {
    const names = row.list
        .slice(0, 3)
        .map((account) => account.nickname || account.email)
        .join('、')
    if (row.list.length <= 3) return names
    return names + text(` 等 ${row.list.length} 个`, ` +${row.list.length - 3} more`)
}

function tokenStatus(account) {
    const expiresAt = account.credentials?.expiresAt
    if (!expiresAt) return text('未知', 'Unknown')
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return text('已过期', 'Expired')
    const minutes = Math.floor(remaining / 60000)
    if (minutes < 60) return text(`${minutes} 分钟`, `${minutes} min`)
    const hours = Math.floor(minutes / 60)
    return text(`${hours} 小时`, `${hours} hours`)
}

function datePart(value, fallback = '') {
    try {
        return (typeof value === 'string' ? value : new Date(value).toISOString()).split('T')[0]
    } catch {
        return fallback
    }
}

function subscriptionDate(value) {
    return new Date(value).toLocaleDateString('zh-CN')
}
</script>

<template>
    <div class="kam-page home-page" data-testid="page-home">
        <header class="kam-page-header home-header">
            <div class="home-welcome">
                <img :src="kiroLogo" alt="Kiro" class="home-logo" />
                <div>
                    <h1>
                        {{ text('欢迎使用 Kiro 账户管理器', 'Welcome to Kiro Account Manager') }}
                    </h1>
                    <p class="kam-muted">
                        {{
                            text(
                                '管理你的 Kiro IDE 账号，一键切换，高效开发',
                                'Manage your Kiro IDE accounts, one-click switch'
                            )
                        }}
                    </p>
                </div>
            </div>
        </header>

        <div class="home-stats" data-testid="home-stats">
            <UiCard v-for="stat in statCards" :key="stat.key" density="compact">
                <div class="home-stat">
                    <component :is="stat.icon" :size="20" aria-hidden="true" />
                    <div>
                        <strong>{{ stat.value }}</strong>
                        <span class="kam-muted">{{ stat.label }}</span>
                    </div>
                </div>
            </UiCard>
        </div>

        <UiCard
            v-if="warningRows.length"
            :title="text('需要关注', 'Attention Needed')"
            density="compact"
            data-testid="home-warnings"
        >
            <p class="kam-muted home-section-hint">
                {{ text('点击查看受影响的账号', 'Click a row to view affected accounts') }}
            </p>
            <div class="home-warning-list">
                <UiButton
                    v-for="row in warningRows"
                    :key="row.key"
                    variant="ghost"
                    class="home-warning-button"
                    :data-testid="`home-warning-${row.key}`"
                    @click="jumpToAccounts(row.filter)"
                >
                    <component :is="row.icon" :size="18" aria-hidden="true" />
                    <UiBadge dense>{{ row.list.length }}</UiBadge>
                    <span class="home-warning-label">{{ row.label }}</span>
                    <span class="kam-muted home-warning-hint">{{ row.hint }}</span>
                    <span class="kam-muted home-warning-preview">{{ warningPreview(row) }}</span>
                    <ChevronRight :size="16" aria-hidden="true" />
                </UiButton>
            </div>
        </UiCard>

        <UiCard
            v-if="usageStats.validAccountCount > 0"
            :title="text('额度统计', 'Usage Stats')"
            density="compact"
            data-testid="home-usage"
        >
            <p class="kam-muted home-section-hint">
                {{
                    text(
                        `基于 ${usageStats.validAccountCount} 个有效账号`,
                        `Based on ${usageStats.validAccountCount} valid accounts`
                    )
                }}
            </p>
            <div class="home-metrics">
                <div class="home-metric">
                    <TrendingUp :size="17" aria-hidden="true" />
                    <span class="kam-muted">{{ text('总额度', 'Total') }}</span>
                    <strong>{{ usageStats.totalLimit.toLocaleString() }}</strong>
                </div>
                <div class="home-metric">
                    <Activity :size="17" aria-hidden="true" />
                    <span class="kam-muted">{{ text('已使用', 'Used') }}</span>
                    <strong>{{ usageStats.totalUsed.toLocaleString() }}</strong>
                </div>
                <div class="home-metric">
                    <Zap :size="17" aria-hidden="true" />
                    <span class="kam-muted">{{ text('剩余额度', 'Remaining') }}</span>
                    <strong>{{ usageStats.remaining.toLocaleString() }}</strong>
                </div>
                <div class="home-metric">
                    <Activity :size="17" aria-hidden="true" />
                    <span class="kam-muted">{{ text('使用率', 'Usage %') }}</span>
                    <strong>{{ usageStats.percentUsed.toFixed(precision) }}%</strong>
                </div>
            </div>
            <div class="home-progress-header">
                <span class="kam-muted">{{ text('总体使用进度', 'Overall Progress') }}</span>
                <span
                    >{{
                        usageStats.totalUsed.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    }}
                    / {{ usageStats.totalLimit.toLocaleString() }} ·
                    {{ usageStats.percentUsed.toFixed(precision) }}%</span
                >
            </div>
            <UiProgress
                :value="usageStats.percentUsed"
                :max="100"
                :tone="overQuota ? 'error' : usageStats.percentUsed >= 80 ? 'warning' : 'accent'"
                :label="text('总体使用进度', 'Overall Progress')"
            />
            <UiAlert
                v-if="overQuota"
                tone="error"
                :title="text('已超额', 'Over Quota')"
                class="home-overquota"
            >
                {{
                    text(
                        `超出 +${overPercent.toFixed(precision)}%，超额积分：${overAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                        `Excess +${overPercent.toFixed(precision)}%, credits: ${overAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    )
                }}
            </UiAlert>
        </UiCard>

        <UiCard
            v-if="activeAccount"
            :title="text('当前使用账号', 'Current Account')"
            density="compact"
            data-testid="home-current"
        >
            <div class="home-account-head">
                <div>
                    <strong>{{ activeAccount.nickname || activeAccount.email }}</strong>
                    <p class="kam-muted">{{ activeAccount.email }}</p>
                </div>
                <UiBadge>{{
                    activeAccount.subscription?.title || activeAccount.subscription?.type || 'Free'
                }}</UiBadge>
            </div>
            <dl class="home-details">
                <div>
                    <dt>{{ text('本月用量', 'Monthly Usage') }}</dt>
                    <dd>
                        {{ activeAccount.usage?.current || 0 }} /
                        {{ activeAccount.usage?.limit || 0 }}
                    </dd>
                    <UiProgress
                        :value="(activeAccount.usage?.percentUsed || 0) * 100"
                        :max="100"
                        :tone="(activeAccount.usage?.percentUsed || 0) > 0.8 ? 'error' : 'accent'"
                        :label="text('本月用量', 'Monthly Usage')"
                        dense
                    />
                </div>
                <div>
                    <dt>{{ text('订阅剩余', 'Subscription') }}</dt>
                    <dd>
                        {{
                            activeAccount.subscription?.daysRemaining != null
                                ? text(
                                      `${activeAccount.subscription.daysRemaining} 天`,
                                      `${activeAccount.subscription.daysRemaining} days`
                                  )
                                : text('永久', 'Permanent')
                        }}
                    </dd>
                </div>
                <div>
                    <dt>{{ text('Token 状态', 'Token Status') }}</dt>
                    <dd>{{ tokenStatus(activeAccount) }}</dd>
                </div>
                <div>
                    <dt>{{ text('登录方式', 'Auth Method') }}</dt>
                    <dd>
                        {{
                            activeAccount.credentials?.authMethod === 'social'
                                ? activeAccount.credentials?.provider || 'Social'
                                : 'Builder ID'
                        }}
                    </dd>
                </div>
            </dl>
            <section class="home-detail-section">
                <h2>{{ text('订阅详情', 'Subscription Details') }}</h2>
                <dl class="home-detail-grid">
                    <div>
                        <dt>{{ text('订阅类型', 'Type') }}</dt>
                        <dd>
                            {{
                                activeAccount.subscription?.title ||
                                activeAccount.subscription?.type ||
                                'Free'
                            }}
                        </dd>
                    </div>
                    <div v-if="activeAccount.subscription?.rawType">
                        <dt>{{ text('原始类型', 'Raw Type') }}</dt>
                        <dd class="kam-mono">{{ activeAccount.subscription.rawType }}</dd>
                    </div>
                    <div v-if="activeAccount.subscription?.expiresAt">
                        <dt>{{ text('到期时间', 'Expires') }}</dt>
                        <dd>{{ subscriptionDate(activeAccount.subscription.expiresAt) }}</dd>
                    </div>
                    <div v-if="activeAccount.subscription?.upgradeCapability">
                        <dt>{{ text('可升级', 'Upgradeable') }}</dt>
                        <dd>{{ activeAccount.subscription.upgradeCapability }}</dd>
                    </div>
                    <div v-if="activeAccount.subscription?.overageCapability">
                        <dt>{{ text('超额能力', 'Overage') }}</dt>
                        <dd>{{ activeAccount.subscription.overageCapability }}</dd>
                    </div>
                </dl>
            </section>
            <section
                v-if="
                    activeAccount.usage?.baseLimit ||
                    activeAccount.usage?.freeTrialLimit ||
                    activeAccount.usage?.bonuses?.length
                "
                class="home-detail-section"
            >
                <h2>{{ text('额度明细', 'Quota Details') }}</h2>
                <dl class="home-detail-grid">
                    <div v-if="activeAccount.usage?.baseLimit > 0">
                        <dt>{{ text('基础额度', 'Base') }}</dt>
                        <dd>
                            {{ activeAccount.usage.baseCurrent ?? 0 }} /
                            {{ activeAccount.usage.baseLimit }}
                        </dd>
                    </div>
                    <div v-if="activeAccount.usage?.freeTrialLimit > 0">
                        <dt>{{ text('试用额度', 'Trial') }}</dt>
                        <dd>
                            {{ activeAccount.usage.freeTrialCurrent ?? 0 }} /
                            {{ activeAccount.usage.freeTrialLimit }}
                            <span v-if="activeAccount.usage.freeTrialExpiry" class="kam-muted"
                                >({{ text('至', 'until') }}
                                {{ datePart(activeAccount.usage.freeTrialExpiry) }})</span
                            >
                        </dd>
                    </div>
                    <div v-for="bonus in activeAccount.usage?.bonuses || []" :key="bonus.code">
                        <dt>{{ bonus.name }}</dt>
                        <dd>
                            {{ bonus.current }} / {{ bonus.limit }}
                            <span v-if="bonus.expiresAt" class="kam-muted"
                                >({{ text('至', 'until') }} {{ datePart(bonus.expiresAt) }})</span
                            >
                        </dd>
                    </div>
                </dl>
            </section>
            <section class="home-detail-section">
                <h2>{{ text('账户信息', 'Account Info') }}</h2>
                <dl class="home-detail-grid">
                    <div>
                        <dt>User ID</dt>
                        <dd class="kam-mono">{{ activeAccount.userId }}</dd>
                    </div>
                    <div>
                        <dt>IDP</dt>
                        <dd>{{ activeAccount.idp || 'BuilderId' }}</dd>
                    </div>
                    <div v-if="activeAccount.usage?.nextResetDate">
                        <dt>{{ text('重置日期', 'Reset Date') }}</dt>
                        <dd>
                            {{
                                datePart(activeAccount.usage.nextResetDate, text('未知', 'Unknown'))
                            }}
                        </dd>
                    </div>
                </dl>
            </section>
        </UiCard>

        <UiCard :title="text('快速提示', 'Quick Tips')" density="compact">
            <ul class="home-tips kam-muted">
                <li>
                    <Shield :size="16" aria-hidden="true" />{{
                        text(
                            '点击左侧「账户管理」可以查看和管理所有账号',
                            'Click "Accounts" to view and manage all accounts'
                        )
                    }}
                </li>
                <li>
                    <Shield :size="16" aria-hidden="true" />{{
                        text(
                            '在账号卡片上点击电源图标可以快速切换账号',
                            'Click power icon on account card to switch'
                        )
                    }}
                </li>
                <li>
                    <Shield :size="16" aria-hidden="true" />{{
                        text(
                            'Token 会在过期前 5 分钟自动刷新，无需手动操作',
                            'Tokens auto-refresh 5 minutes before expiry'
                        )
                    }}
                </li>
                <li>
                    <Shield :size="16" aria-hidden="true" />{{
                        text(
                            '使用「隐私模式」可以隐藏邮箱和账号信息',
                            'Use "Privacy Mode" to hide sensitive info'
                        )
                    }}
                </li>
            </ul>
        </UiCard>

        <div class="home-features">
            <UiCard v-for="feature in features" :key="feature.key" density="compact">
                <div class="home-feature">
                    <component :is="feature.icon" :size="20" aria-hidden="true" />
                    <div>
                        <strong>{{ text(feature.zh, feature.en) }}</strong>
                        <p class="kam-muted">{{ text(feature.detailZh, feature.detailEn) }}</p>
                    </div>
                </div>
            </UiCard>
        </div>
    </div>
</template>

<style scoped>
.home-welcome,
.home-stat,
.home-feature,
.home-account-head {
    display: flex;
    align-items: center;
    gap: 12px;
}
.home-logo {
    width: 40px;
    height: 40px;
    object-fit: contain;
}
.home-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
}
.home-stat strong {
    display: block;
    font-size: 24px;
    line-height: 1.25;
}
.home-stat span {
    display: block;
    font-size: 12px;
}
.home-section-hint {
    margin-bottom: 12px !important;
    font-size: 12px;
}
.home-warning-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.home-warning-button {
    width: 100%;
    justify-content: flex-start;
    text-align: left;
    min-width: 0;
}
.home-warning-label {
    font-weight: 600;
}
.home-warning-hint {
    font-size: 12px;
}
.home-warning-preview {
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
}
.home-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
}
.home-metric {
    display: grid;
    gap: 4px;
    align-content: start;
}
.home-metric strong {
    font-size: 20px;
    overflow-wrap: anywhere;
}
.home-progress-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    font-size: 12px;
}
.home-overquota {
    margin-top: 12px;
}
.home-account-head {
    justify-content: space-between;
    flex-wrap: wrap;
}
.home-account-head p {
    font-size: 12px;
}
.home-details {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
}
.home-details > div,
.home-detail-grid > div {
    min-width: 0;
}
.home-details dt,
.home-detail-grid dt {
    color: var(--muted);
    font-size: 12px;
}
.home-details dd,
.home-detail-grid dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
}
.home-details :deep(.ui-progress) {
    margin-top: 6px;
}
.home-detail-section {
    border-top: 1px solid var(--border);
    padding-top: 12px;
}
.home-detail-section h2 {
    margin: 0 0 8px;
    font-size: 14px;
}
.home-detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
    margin: 0;
}
.home-tips {
    display: grid;
    gap: 8px;
    padding: 0;
    margin: 0;
    list-style: none;
}
.home-tips li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}
.home-tips svg {
    flex: none;
    margin-top: 2px;
}
.home-features {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
}
.home-feature {
    align-items: flex-start;
}
.home-feature svg {
    flex: none;
}
.home-feature p {
    font-size: 12px;
}
@media (max-width: 950px) {
    .home-stats,
    .home-metrics,
    .home-details {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .home-features {
        grid-template-columns: minmax(0, 1fr);
    }
}
@media (max-width: 560px) {
    .home-stats,
    .home-metrics,
    .home-details,
    .home-detail-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    .home-warning-hint {
        display: none;
    }
}
</style>
