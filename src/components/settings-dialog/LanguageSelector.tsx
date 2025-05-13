import { useCallback, useEffect, useState } from "react";
import Select from "react-select";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";

const languageOptions = [
  { value: "en-US", label: "English (US)" },
  { value: "tr-TR", label: "Turkish (Türkçe)" },
  { value: "ru-RU", label: "Russian (Русский)" },
  { value: "de-DE", label: "German (Deutsch)" },
  { value: "fr-FR", label: "French (Français)" },
];

export default function LanguageSelector() {
  const { config, setConfig } = useLiveAPIContext();

  useEffect(() => {
    const languageCode =
      config.generationConfig?.speechConfig?.language_code || "en-US";
    const languageOption = languageOptions.find(option => option.value === languageCode) || 
      { value: languageCode, label: languageCode };
    setSelectedOption(languageOption);
  }, [config]);

  const [selectedOption, setSelectedOption] = useState<{
    value: string;
    label: string;
  } | null>(languageOptions[0]);

  const updateConfig = useCallback(
    (languageCode: string) => {
      setConfig({
        ...config,
        generationConfig: {
          ...config.generationConfig,
          speechConfig: {
            ...config.generationConfig?.speechConfig,
            language_code: languageCode,
          },
        },
      });
    },
    [config, setConfig]
  );

  return (
    <div className="select-group">
      <label htmlFor="language-selector">Language</label>
      <Select
        id="language-selector"
        className="react-select"
        classNamePrefix="react-select"
        styles={{
          control: (baseStyles) => ({
            ...baseStyles,
            background: "var(--Neutral-15)",
            color: "var(--Neutral-90)",
            minHeight: "33px",
            maxHeight: "33px",
            border: 0,
          }),
          option: (styles, { isFocused, isSelected }) => ({
            ...styles,
            backgroundColor: isFocused
              ? "var(--Neutral-30)"
              : isSelected
              ? "var(--Neutral-20)"
              : undefined,
          }),
        }}
        value={selectedOption}
        defaultValue={selectedOption}
        options={languageOptions}
        onChange={(e) => {
          setSelectedOption(e);
          if (e) {
            updateConfig(e.value);
          }
        }}
      />
    </div>
  );
} 