import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zh from '../locales/zh-CN.json';
const saved = localStorage.getItem('evertraceLanguage');
const language = saved === 'en' || saved === 'zh-CN' ? saved : 'en';
void i18n.use(initReactI18next).init({ resources: { en: { translation: en }, 'zh-CN': { translation: zh } }, lng: language, fallbackLng: 'en', interpolation: { escapeValue: false } });
export default i18n;
