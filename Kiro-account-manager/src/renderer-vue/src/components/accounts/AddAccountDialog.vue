<script setup>
import { computed, toRef } from 'vue'
import {
    UiAlert,
    UiButton,
    UiCard,
    UiDialog,
    UiField,
    UiInput,
    UiSelect,
    UiSwitch,
    UiTextarea
} from '@lingyzh/ui'
import { Clipboard, Download, LogIn, Plus } from 'lucide-vue-next'
import { useTranslation } from '../../composables/useTranslation'
import { useAddAccount } from '../../composables/useAddAccount'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])
const { actualLanguage } = useTranslation()
const isEn = computed(() => actualLanguage.value === 'en')
const dialog = useAddAccount(toRef(props, 'open'), () => emit('update:open', false), isEn)
const {
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
} = dialog
const groups = computed(() => Array.from(accountsStore.groups.values()))
const busy = computed(() => isVerifying.value || isSubmitting.value || importingLocal.value)

function text(zh, en) {
    return isEn.value ? en : zh
}
</script>

<template>
    <UiDialog
        :open="open"
        size="lg"
        scrollable
        :aria-label="text('添加账号', 'Add account')"
        :content-label="text('添加账号方式', 'Add account method')"
        data-testid="account-add-dialog"
        @update:open="
            (value) => {
                if (!value) requestClose()
            }
        "
    >
        <template #header
            ><h2>{{ text('添加账号', 'Add account') }}</h2></template
        >
        <div class="kam-dialog-content">
            <div class="kam-add-tabs" role="group" :aria-label="text('添加方式', 'Add method')">
                <UiButton
                    v-for="mode in ['login', 'oidc', 'sso']"
                    :key="mode"
                    :variant="importMode === mode ? 'primary' : 'secondary'"
                    :aria-pressed="importMode === mode"
                    :data-testid="`add-mode-${mode}`"
                    :disabled="isLoggingIn || busy"
                    @click="importMode = mode"
                >
                    {{
                        mode === 'login'
                            ? text('浏览器登录', 'Browser login')
                            : mode === 'oidc'
                              ? 'OIDC'
                              : 'SSO Token'
                    }}
                </UiButton>
            </div>

            <UiField :label="text('目标分组', 'Target group')" for="add-target-group">
                <UiSelect
                    id="add-target-group"
                    v-model="selectedGroupId"
                    data-testid="add-target-group"
                >
                    <option :value="undefined">{{ text('未分组', 'Ungrouped') }}</option>
                    <option v-for="group in groups" :key="group.id" :value="group.id">
                        {{ group.name }}
                    </option>
                </UiSelect>
            </UiField>
            <UiAlert
                v-if="error"
                tone="error"
                :title="text('添加失败', 'Could not add account')"
                data-testid="add-error"
                >{{ error }}</UiAlert
            >

            <div
                v-if="importMode === 'login'"
                class="kam-dialog-content"
                data-testid="add-login-panel"
            >
                <div class="kam-add-methods">
                    <UiButton
                        v-for="method in ['builderid', 'google', 'github', 'iamsso']"
                        :key="method"
                        :variant="loginType === method ? 'primary' : 'secondary'"
                        :disabled="isLoggingIn"
                        :data-testid="`add-login-${method}`"
                        @click="loginType = method"
                    >
                        {{
                            method === 'builderid'
                                ? 'Builder ID'
                                : method === 'google'
                                  ? 'Google'
                                  : method === 'github'
                                    ? 'GitHub'
                                    : 'IAM SSO'
                        }}
                    </UiButton>
                </div>
                <UiSwitch v-model="usePrivateMode" data-testid="add-private-mode">{{
                    text('使用浏览器隐私模式', 'Use private browser window')
                }}</UiSwitch>
                <UiField :label="text('区域', 'Region')" for="add-login-region">
                    <UiInput
                        id="add-login-region"
                        v-model="region"
                        data-testid="add-login-region"
                        placeholder="us-east-1"
                    />
                </UiField>
                <template v-if="loginType === 'iamsso'">
                    <UiField label="SSO Start URL" for="add-sso-start-url">
                        <UiInput
                            id="add-sso-start-url"
                            v-model="ssoStartUrl"
                            data-testid="add-sso-start-url"
                            placeholder="https://example.awsapps.com/start"
                        />
                    </UiField>
                    <UiButton
                        v-if="!isLoggingIn"
                        variant="primary"
                        data-testid="add-start-iam"
                        @click="startIamSso"
                        ><LogIn :size="16" />{{
                            text('启动 IAM 登录', 'Start IAM login')
                        }}</UiButton
                    >
                </template>
                <UiButton
                    v-else-if="!isLoggingIn"
                    variant="primary"
                    data-testid="add-start-login"
                    @click="
                        loginType === 'builderid'
                            ? startBuilderId()
                            : startSocial(loginType === 'google' ? 'Google' : 'Github')
                    "
                >
                    <LogIn :size="16" />{{ text('启动登录', 'Start login') }}
                </UiButton>
                <UiCard v-if="builderIdLoginData" compact>
                    <p>{{ text('在浏览器中输入此代码', 'Enter this code in your browser') }}</p>
                    <div class="kam-add-code kam-actions">
                        <code class="kam-mono" data-testid="add-user-code">{{
                            builderIdLoginData.userCode
                        }}</code>
                        <UiButton
                            variant="secondary"
                            data-testid="add-copy-code"
                            @click="copyUserCode"
                            ><Clipboard :size="16" />{{
                                copied ? text('已复制', 'Copied') : text('复制', 'Copy')
                            }}</UiButton
                        >
                    </div>
                    <p class="kam-muted">{{ builderIdLoginData.verificationUri }}</p>
                </UiCard>
                <UiCard v-if="iamSsoLoginData" compact>
                    <p>{{ text('等待浏览器授权…', 'Waiting for browser authorization…') }}</p>
                    <p class="kam-muted kam-mono">{{ iamSsoLoginData.verificationUri }}</p>
                </UiCard>
                <p
                    v-if="isLoggingIn && !builderIdLoginData && !iamSsoLoginData"
                    class="kam-muted"
                    data-testid="add-login-waiting"
                >
                    {{ text('等待授权…', 'Waiting for authorization…') }}
                </p>
                <UiButton
                    v-if="isLoggingIn"
                    variant="ghost"
                    data-testid="add-cancel-login"
                    @click="cancelLogin"
                    >{{ text('取消登录', 'Cancel login') }}</UiButton
                >
            </div>

            <div
                v-else-if="importMode === 'oidc'"
                class="kam-dialog-content"
                data-testid="add-oidc-panel"
            >
                <div class="kam-add-tabs">
                    <UiButton
                        :variant="oidcImportMode === 'single' ? 'primary' : 'secondary'"
                        data-testid="add-oidc-single"
                        :disabled="busy"
                        @click="oidcImportMode = 'single'"
                        >{{ text('单个账号', 'Single account') }}</UiButton
                    >
                    <UiButton
                        :variant="oidcImportMode === 'batch' ? 'primary' : 'secondary'"
                        data-testid="add-oidc-batch"
                        :disabled="busy"
                        @click="oidcImportMode = 'batch'"
                        >{{ text('批量导入', 'Batch import') }}</UiButton
                    >
                </div>
                <template v-if="oidcImportMode === 'single'">
                    <UiButton
                        variant="secondary"
                        data-testid="add-import-local"
                        :loading="importingLocal"
                        :disabled="busy"
                        @click="importLocal"
                        ><Download :size="16" />{{
                            text('从本地配置读取', 'Read local credentials')
                        }}</UiButton
                    >
                    <UiField label="Refresh Token" for="add-refresh-token"
                        ><UiTextarea
                            id="add-refresh-token"
                            v-model="refreshToken"
                            data-testid="add-refresh-token"
                            :rows="3"
                    /></UiField>
                    <div class="kam-add-grid">
                        <UiField :label="text('认证方式', 'Auth method')" for="add-auth-method">
                            <UiSelect
                                id="add-auth-method"
                                v-model="authMethod"
                                data-testid="add-auth-method"
                                ><option value="IdC">IdC</option>
                                <option value="social">Social</option></UiSelect
                            >
                        </UiField>
                        <UiField :label="text('登录来源', 'Provider')" for="add-provider">
                            <UiSelect
                                id="add-provider"
                                v-model="provider"
                                data-testid="add-provider"
                                ><option value="BuilderId">BuilderId</option>
                                <option value="Enterprise">Enterprise</option>
                                <option value="Google">Google</option>
                                <option value="Github">GitHub</option></UiSelect
                            >
                        </UiField>
                    </div>
                    <UiField label="Client ID" for="add-client-id"
                        ><UiInput id="add-client-id" v-model="clientId" data-testid="add-client-id"
                    /></UiField>
                    <UiField label="Client Secret" for="add-client-secret"
                        ><UiInput
                            id="add-client-secret"
                            v-model="clientSecret"
                            type="password"
                            data-testid="add-client-secret"
                    /></UiField>
                    <UiField :label="text('区域', 'Region')" for="add-oidc-region"
                        ><UiInput
                            id="add-oidc-region"
                            v-model="region"
                            data-testid="add-oidc-region"
                    /></UiField>
                    <UiButton
                        variant="primary"
                        :loading="isSubmitting"
                        :disabled="busy"
                        data-testid="add-oidc-submit"
                        @click="addSingleOidc"
                        ><Plus :size="16" />{{ text('验证并添加', 'Verify and add') }}</UiButton
                    >
                </template>
                <template v-else>
                    <p class="kam-muted">
                        {{
                            text(
                                '输入 JSON 对象或数组，或六字段卡密；每行一条。',
                                'Enter a JSON object or array, or six-field card keys, one per line.'
                            )
                        }}
                    </p>
                    <UiField :label="text('凭证数据', 'Credentials')" for="add-oidc-batch-data"
                        ><UiTextarea
                            id="add-oidc-batch-data"
                            v-model="oidcBatchData"
                            :rows="8"
                            data-testid="add-oidc-batch-data"
                    /></UiField>
                    <UiButton
                        variant="primary"
                        :loading="isSubmitting"
                        :disabled="busy"
                        data-testid="add-oidc-batch-submit"
                        @click="batchOidc"
                        ><Plus :size="16" />{{
                            text('批量验证并添加', 'Verify and add batch')
                        }}</UiButton
                    >
                    <UiAlert
                        v-if="oidcResult"
                        tone="info"
                        :title="text('导入结果', 'Import result')"
                        data-testid="add-oidc-result"
                        >{{ oidcResult.success }} / {{ oidcResult.total }} ·
                        {{ text('失败', 'Failed') }} {{ oidcResult.failed }}</UiAlert
                    >
                </template>
            </div>

            <div v-else class="kam-dialog-content" data-testid="add-sso-panel">
                <p class="kam-muted">
                    {{
                        text(
                            '每行输入一个 x-amz-sso_authn Token。',
                            'Enter one x-amz-sso_authn token per line.'
                        )
                    }}
                </p>
                <UiField label="x-amz-sso_authn" for="add-sso-tokens"
                    ><UiTextarea
                        id="add-sso-tokens"
                        v-model="ssoToken"
                        :rows="7"
                        data-testid="add-sso-tokens"
                /></UiField>
                <UiField :label="text('区域', 'Region')" for="add-sso-region"
                    ><UiInput id="add-sso-region" v-model="region" data-testid="add-sso-region"
                /></UiField>
                <UiButton
                    variant="primary"
                    :loading="isVerifying"
                    :disabled="busy"
                    data-testid="add-sso-submit"
                    @click="batchSso"
                    ><Plus :size="16" />{{ text('导入 Token', 'Import tokens') }}</UiButton
                >
                <UiAlert
                    v-if="ssoResult"
                    tone="info"
                    :title="text('导入结果', 'Import result')"
                    data-testid="add-sso-result"
                    >{{ ssoResult.success }} / {{ ssoResult.total }} · {{ text('失败', 'Failed') }}
                    {{ ssoResult.failed }}</UiAlert
                >
            </div>
        </div>
        <template #footer
            ><UiButton variant="ghost" data-testid="add-close" @click="requestClose">{{
                text('关闭', 'Close')
            }}</UiButton></template
        >
    </UiDialog>
</template>

<style scoped>
.kam-add-tabs,
.kam-add-methods {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.kam-add-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}
.kam-add-grid > * {
    min-width: 0;
}
.kam-add-code {
    margin: 8px 0;
}
@media (max-width: 700px) {
    .kam-add-grid {
        grid-template-columns: 1fr;
    }
}
</style>
