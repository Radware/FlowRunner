export default {
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
    moduleNameMapper: {
        '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
        '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$': '<rootDir>/__mocks__/fileMock.js'
    },
    transform: {
        '^.+\\.[jt]sx?$': 'babel-jest',
    },
    moduleFileExtensions: ['js', 'mjs'],
    testMatch: ['**/__tests__/**/*.test.js'],
    // Ignore node_modules AND .claude/ (workflow worktrees / vendored spikes are full
    // repo checkouts whose __tests__/ would otherwise be scanned as duplicate suites).
    // visualizer-island/ is a self-contained Vite app with its own tests, not part of this suite.
    testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/visualizer-island/'],
    verbose: true,
    injectGlobals: true
};