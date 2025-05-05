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
    testPathIgnorePatterns: ['/node_modules/'],
    verbose: true,
    injectGlobals: true
};