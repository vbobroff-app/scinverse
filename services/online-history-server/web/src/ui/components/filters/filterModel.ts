/**
 * Модель generic-фильтров таблиц ([+] добавить · плашки со значением · [x] снять · поиск).
 * Компоненты не знают о конкретном сторе/сущности — вся привязка через эти описания и колбэки.
 * Один и тот же интерфейс переиспользуется панелью провайдеров и разделом «Биржи» (у каждого
 * вида инструмента — свой набор фильтров).
 */

/** Опция фильтра в поповере. */
export interface FilterOption {
  id: string;
  label: string;
  /** Доп. счётчик справа (напр. число выделенных инструментов). */
  count?: number;
  /** Недоступна для выбора (галка disabled). */
  disabled?: boolean;
  /** Подсказка справа / title (напр. почему disabled). */
  title?: string;
}

/** Описание одной плашки-фильтра: как отрисовать поповер и куда отдать выбор. */
export interface FilterSpec {
  key: string;
  name: string;
  /** single — радио (0/1 значение), multi — чекбоксы (комбинируются по ИЛИ). */
  mode: 'single' | 'multi';
  options: FilterOption[];
  /** Выбранные id. Пустой id ('') трактуется как нейтраль (без значения на плашке). */
  selected: string[];
  onChange: (selected: string[]) => void;
  /**
   * multi: мастер-галка «Все» + разделитель (как в NC DockFilters).
   * Вкл/выкл все опции одной галкой; indeterminate при частичном выборе.
   */
  masterAll?: boolean;
  /** Нижняя секция с radio после разделителя (напр. «Применить» у фильтра «Выбор»). */
  applyScope?: FilterRadioGroup;
  /**
   * Крестик сразу убирает плашку, без сброса значений
   * (напр. «Наборы»: галки живут на сервере).
   */
  removeOnly?: boolean;
  /** Кнопки внизу поповера (напр. «Создать набор…»). */
  footerActions?: { label: string; onClick: () => void }[];
  /** Действие справа от опции (напр. ✎ правка static-набора). */
  optionActions?: Record<string, { label: string; title?: string; onClick: () => void }>;
}

/** Группа radio в нижней секции поповера фильтра. */
export interface FilterRadioGroup {
  label: string;
  options: FilterOption[];
  selected: string;
  onChange: (id: string) => void;
}

/** Пункт меню «добавить фильтр» ([+]). */
export interface FilterMenuItem {
  key: string;
  name: string;
}
