module.exports = {
  root: true,
  extends: './node_modules/@textea/dev-kit/config/eslint',
  env: {
    browser: true,
    node: true
  },
  settings: {
    react: {
      version: 'detect'
    },
    next: {
      rootDir: 'app'
    }
  }
}
