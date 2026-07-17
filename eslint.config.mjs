import babelParser from "@babel/eslint-parser";

export default [{
    files: ["**/*.ts"],
}, {
    languageOptions: {
        parser: babelParser,
        parserOptions: {
            requireConfigFile: false,
            babelOptions: {
                plugins: ["@babel/plugin-syntax-typescript"],
            },
        },
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];