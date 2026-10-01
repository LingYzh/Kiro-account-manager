<script setup>
import { computed } from 'vue'
import { useTranslation } from '../../composables/useTranslation'
import ProxyPanel from '../proxy/ProxyPanel.vue'
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
</script>
<template>
    <section class="kam-page" data-testid="page-proxy">
        <header class="kam-page-header">
            <div>
                <h1>{{ isEn ? 'API Proxy' : 'API 反代' }}</h1>
                <p class="kam-muted">
                    {{
                        isEn
                            ? 'Serve Kiro accounts through compatible APIs'
                            : '通过兼容 API 使用 Kiro 账号'
                    }}
                </p>
            </div>
        </header>
        <ProxyPanel />
    </section>
</template>
