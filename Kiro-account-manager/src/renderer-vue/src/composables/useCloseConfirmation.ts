import { ref, type Ref } from 'vue'

export function useCloseConfirmation(): {
    open: Ref<boolean>
    rememberChoice: Ref<boolean>
    initialize: () => void
    respond: (action: 'minimize' | 'quit' | 'cancel') => void
    handleOpen: (value: boolean) => void
    dispose: () => void
} {
    const open = ref(false)
    const rememberChoice = ref(false)
    let unsubscribe: (() => void) | null = null

    function initialize(): void {
        if (unsubscribe) return
        unsubscribe = window.api.onShowCloseConfirmDialog(() => {
            rememberChoice.value = false
            open.value = true
        })
    }

    function respond(action: 'minimize' | 'quit' | 'cancel'): void {
        if (!open.value) return
        open.value = false
        window.api.sendCloseConfirmResponse(action, rememberChoice.value)
    }

    function handleOpen(value: boolean): void {
        if (!value) respond('cancel')
    }

    function dispose(): void {
        unsubscribe?.()
        unsubscribe = null
    }

    return { open, rememberChoice, initialize, respond, handleOpen, dispose }
}
