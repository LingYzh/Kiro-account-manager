<script setup>
import { computed } from 'vue'
import { useTranslation } from '../../composables/useTranslation'
import KProxyPanel from '../kproxy/KProxyPanel.vue'

const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
</script>

<template>
    <section class="kam-page" data-testid="page-kproxy">
        <header class="kam-page-header">
            <div>
                <h1>K-Proxy MITM</h1>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'MITM proxy for Machine ID replacement, reduces ban risk'
                            : 'MITM 代理，替换 Machine ID，降低封禁风险'
                    }}
                </p>
            </div>
        </header>
        <KProxyPanel />
    </section>
</template>
