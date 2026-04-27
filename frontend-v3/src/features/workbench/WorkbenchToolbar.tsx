import type { ChangeEvent } from "react";

import type { FieldTemplate } from "../../shared/api/fields";
import type { ProviderSummary } from "../../shared/api/providers";

interface WorkbenchToolbarProps {
  providers: ProviderSummary[];
  selectedProvider: string;
  onProviderChange: (value: string) => void;
  modelOptions: string[];
  selectedModel: string;
  onModelChange: (value: string) => void;
  templates: FieldTemplate[];
  selectedTemplateId: string;
  onTemplateChange: (value: string) => void;
  runAllPending: boolean;
  onRunAll: () => void;
  onRefresh: () => void;
  onUploadFiles: (files: File[]) => void;
}

export function WorkbenchToolbar({
  providers,
  selectedProvider,
  onProviderChange,
  modelOptions,
  selectedModel,
  onModelChange,
  templates,
  selectedTemplateId,
  onTemplateChange,
  runAllPending,
  onRunAll,
  onRefresh,
  onUploadFiles,
}: WorkbenchToolbarProps) {
  const disabledRunAll = runAllPending || !selectedProvider;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      onUploadFiles(files);
    }
    event.currentTarget.value = "";
  };

  return (
    <section className="v35-toolbar" aria-label="编辑台工具栏">
      <article className="v35-panel v35-upload-tool">
        <div className="v35-upload-mark">+</div>
        <div>
          <h2 className="v35-section-title">导入文献</h2>
          <p className="v35-muted">PDF / DOCX / TXT</p>
        </div>
        <label className="v35-button v35-button-primary v35-file-label" htmlFor="v35UploadInput">
          选择
        </label>
        <input
          id="v35UploadInput"
          className="v35-file-input"
          type="file"
          accept=".pdf,.txt,.docx"
          multiple
          onChange={handleFileChange}
        />
      </article>

      <article className="v35-panel v35-tool-grid">
        <label className="v35-field" htmlFor="v35ProviderSelect">
          <span>Provider</span>
          <select
            id="v35ProviderSelect"
            className="v35-input"
            value={selectedProvider}
            onChange={(event) => {
              onProviderChange(event.target.value);
            }}
            disabled={providers.length === 0}
          >
            {providers.map((provider) => (
              <option key={provider.provider} value={provider.provider}>
                {provider.provider}
              </option>
            ))}
          </select>
        </label>

        <label className="v35-field" htmlFor="v35ModelSelect">
          <span>Model</span>
          <select
            id="v35ModelSelect"
            className="v35-input"
            value={selectedModel}
            onChange={(event) => {
              onModelChange(event.target.value);
            }}
            disabled={modelOptions.length === 0}
          >
            {modelOptions.length > 0 ? (
              modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            ) : (
              <option value="">未配置模型</option>
            )}
          </select>
        </label>

        <label className="v35-field" htmlFor="v35TemplateSelect">
          <span>编辑模板</span>
          <select
            id="v35TemplateSelect"
            className="v35-input"
            value={selectedTemplateId}
            onChange={(event) => {
              onTemplateChange(event.target.value);
            }}
            disabled={templates.length === 0}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
      </article>

      <article className="v35-panel v35-toolbar-actions">
        <button
          className="v35-button v35-button-primary"
          type="button"
          disabled={disabledRunAll}
          onClick={onRunAll}
        >
          {runAllPending ? "启动中..." : "生成索引"}
        </button>
        <button className="v35-button" type="button" onClick={onRefresh}>刷新</button>
      </article>
    </section>
  );
}
