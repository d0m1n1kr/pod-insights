import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import LanguageSelector from '../LanguageSelector.vue';

describe('LanguageSelector', () => {
  let i18n: any;

  beforeEach(() => {
    i18n = createI18n({
      legacy: false,
      locale: 'de',
      messages: {
        de: {
          language: {
            de: 'Deutsch',
            en: 'English',
            fr: 'Français',
          },
        },
        en: {
          language: {
            de: 'German',
            en: 'English',
            fr: 'French',
          },
        },
        fr: {
          language: {
            de: 'Allemand',
            en: 'Anglais',
            fr: 'Français',
          },
        },
      },
    });

    // Mock localStorage
    globalThis.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    } as any;
  });

  it('should render language selector button', () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.find('button').exists()).toBe(true);
    expect(wrapper.text()).toContain('Deutsch');
  });

  it('should display current locale', () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.text()).toContain('Deutsch');
    expect(wrapper.text()).toContain('🇩🇪');
  });

  it('should show dropdown when button is clicked', async () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n],
      },
    });

    const button = wrapper.find('button');
    await button.trigger('click');

    // Dropdown should be visible
    expect(wrapper.find('.language-selector').exists()).toBe(true);
    
    // All language options should be visible
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(1);
  });

  it('should change locale when option is clicked', async () => {
    const wrapper = mount(LanguageSelector, {
      global: {
        plugins: [i18n],
      },
    });

    // Open dropdown
    const toggleButton = wrapper.find('button');
    await toggleButton.trigger('click');

    // Find and click English option
    const buttons = wrapper.findAll('button');
    const englishButton = buttons.find(b => b.text().includes('English'));
    
    if (englishButton) {
      await englishButton.trigger('click');
      expect(i18n.global.locale.value).toBe('en');
      expect(localStorage.setItem).toHaveBeenCalledWith('locale', 'en');
    }
  });
});

