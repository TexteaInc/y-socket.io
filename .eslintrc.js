module.exports = {
  root: true,
  extends: './node_modules/@textea/dev-kit/config/eslint',
  settings: {
    react: {
      version: 'detect'
    },
    next: {
      rootDir: 'app'
    }
  }
}
