import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

import type { FieldTemplate } from "../../shared/api/fields";
import type { ProviderSummary } from "../../shared/api/providers";
import { isDesktopShell } from "../../shared/lib/runtime";

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
  onUploadFiles: (files: File[]) => void;
  controlsDisabled?: boolean;
  uploadPending?: boolean;
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 13V4" />
      <path d="m6.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M4 15.5h12" />
    </svg>
  );
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
  onUploadFiles,
  controlsDisabled = false,
  uploadPending = false,
}: WorkbenchToolbarProps) {
  const desktopShell = isDesktopShell();
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      onUploadFiles(files);
    }
    event.currentTarget.value = "";
  };
  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) {
      setIsDragActive(true);
    }
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      onUploadFiles(files);
    }
  };

  return (
    <section className="v35-panel v35-toolbar" aria-label="编辑台工具栏">
      <div
        className={`v35-upload-tool ${isDragActive ? "is-drag-active" : ""} ${uploadPending ? "is-uploading" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="v35-upload-mark">+</div>
        <div>
          <h2 className="v35-section-title">{uploadPending ? "正在导入" : desktopShell ? "导入" : "导入文献"}</h2>
          <p className="v35-muted">{isDragActive ? "松手导入文献" : desktopShell ? "PDF DOCX TXT" : "PDF / DOCX / TXT"}</p>
        </div>
        <label
          className={`v35-button v35-button-primary v35-button-compact v35-file-label${desktopShell ? " is-icon-only" : ""}`}
          htmlFor="v35UploadInput"
          aria-label="上传文献"
          title="上传文献"
        >
          <UploadIcon />
          {desktopShell ? null : <span>导入</span>}
        </label>
        <input
          id="v35UploadInput"
          className="v35-file-input"
          type="file"
          accept=".pdf,.txt,.docx"
          multiple
          disabled={uploadPending}
          onChange={handleFileChange}
        />
      </div>

      <div className="v35-tool-grid">
        <label className="v35-field v35-field-inline" htmlFor="v35ProviderSelect">
          <span>Provider</span>
          <select
            id="v35ProviderSelect"
            className="v35-input"
            value={selectedProvider}
            onChange={(event) => {
              onProviderChange(event.target.value);
            }}
            disabled={controlsDisabled || providers.length === 0}
          >
            {providers.map((provider) => (
              <option key={provider.provider} value={provider.provider}>
                {provider.provider}
              </option>
            ))}
          </select>
        </label>

        <label className="v35-field v35-field-inline" htmlFor="v35ModelSelect">
          <span>Model</span>
          <select
            id="v35ModelSelect"
            className="v35-input"
            value={selectedModel}
            onChange={(event) => {
              onModelChange(event.target.value);
            }}
            disabled={controlsDisabled || modelOptions.length === 0}
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

        <label className="v35-field v35-field-inline" htmlFor="v35TemplateSelect">
          <span>编辑模板</span>
          <select
            id="v35TemplateSelect"
            className="v35-input"
            value={selectedTemplateId}
            onChange={(event) => {
              onTemplateChange(event.target.value);
            }}
            disabled={controlsDisabled || templates.length === 0}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
