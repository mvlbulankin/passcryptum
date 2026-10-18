import { useDialog } from 'naive-ui'
import { h } from 'vue'

export const showPublicKeyError = (dialog: ReturnType<typeof useDialog>) => {
  dialog.warning({
    title: 'Public Key Not Registered',
    content: () =>
      h('div', [
        h('p', 'Your public key is not in the whitelist'),
        h('p', [
          'Please contact the administrator at ',
          h(
            'a',
            { href: 'https://t.me/passcryptum' },
            'https://t.me/passcryptum',
          ),
          ' to register your public key',
        ]),
      ]),
    positiveText: 'OK',
    onPositiveClick() {},
  })
}
