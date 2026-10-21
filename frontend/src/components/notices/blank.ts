import type { NoticeContent } from '../../api';

/** A notice started from scratch: the banner look with one empty field to fill in. */
export function blankNotice(): NoticeContent {
  return {
    style: 'banner',
    color: '#2a7fba',
    eyebrow: '',
    headline: '',
    title: '',
    sections: [{ kind: 'field', label: 'Details', value: '' }],
    footer: '',
    brand: '',
    brandTag: '',
    logo: '',
    logoHeight: 48,
  };
}
