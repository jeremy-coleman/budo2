/**
 * FileTools defined as any.
 * This should not be imported or used in future releases or in any module in the framework
 * @hidden
 * @deprecated import the needed function from fileTools.ts
 */
let FileTools;
/** @hidden */
const _injectLTSFileTools = (DecodeBase64UrlToBinary, DecodeBase64UrlToString, FileToolsOptions, IsBase64DataUrl, IsFileURL, LoadFile, LoadImage, ReadFile, RequestFile, SetCorsBehavior) => {
    /**
 * Backwards compatibility.
 * @hidden
 * @deprecated
 */
    FileTools = {
        DecodeBase64UrlToBinary,
        DecodeBase64UrlToString,
        DefaultRetryStrategy: FileToolsOptions.DefaultRetryStrategy,
        BaseUrl: FileToolsOptions.BaseUrl,
        CorsBehavior: FileToolsOptions.CorsBehavior,
        PreprocessUrl: FileToolsOptions.PreprocessUrl,
        IsBase64DataUrl,
        IsFileURL,
        LoadFile,
        LoadImage,
        ReadFile,
        RequestFile,
        SetCorsBehavior,
    };
    Object.defineProperty(FileTools, "DefaultRetryStrategy", {
        get: function () {
            return FileToolsOptions.DefaultRetryStrategy;
        },
        set: function (value) {
            FileToolsOptions.DefaultRetryStrategy = value;
        }
    });
    Object.defineProperty(FileTools, "BaseUrl", {
        get: function () {
            return FileToolsOptions.BaseUrl;
        },
        set: function (value) {
            FileToolsOptions.BaseUrl = value;
        }
    });
    Object.defineProperty(FileTools, "PreprocessUrl", {
        get: function () {
            return FileToolsOptions.PreprocessUrl;
        },
        set: function (value) {
            FileToolsOptions.PreprocessUrl = value;
        }
    });
    Object.defineProperty(FileTools, "CorsBehavior", {
        get: function () {
            return FileToolsOptions.CorsBehavior;
        },
        set: function (value) {
            FileToolsOptions.CorsBehavior = value;
        }
    });
};

export { FileTools, _injectLTSFileTools };
