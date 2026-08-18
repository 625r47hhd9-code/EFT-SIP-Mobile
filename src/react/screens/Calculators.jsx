import { useMemo } from "react";
import { calculateTerraceRoof } from "../../calculations/terrace-model.js";
import { useProject } from "../state/ProjectContext.jsx";
import { calculateProject } from "../calculations/estimate-engine.js";
import { SIP_JOINERY_TYPES } from "../calculations/sip-joinery.js";
import {
  NumberField,
  Panel,
  EditableEstimateTable,
  PreviewTable,
  ScreenHeader,
  SelectField,
  Stat,
  Toggle,
} from "../components/ui.jsx";
import { formatNumber } from "../utils/format.js";
import {
  addEstimateLine,
  changeEstimateLine,
  removeEstimateLine,
  resetEstimateLine,
  resetEstimateSection,
} from "../state/estimate-edits.js";

const TITLES = {
  piles: [
    "Свайное поле и обвязка",
    "Дом и пристройки считаются как единая геометрия без повторяющихся свай",
  ],
  sip: [
    "СИП-конструкции",
    "Пол, наружные стены, потолок, перегородки, проёмы и раскрой",
  ],
  roof: [
    "Кровля",
    "Основная крыша и кровли террас считаются отдельно, затем объединяются в ведомость",
  ],
  terrace: [
    "Терраса и крыльцо",
    "Настил, каркас, ступени и конструктивные параметры каждой площадки",
  ],
  openings: ["Окна и двери", "Проёмы берутся непосредственно с плана дома"],
  engineering: [
    "Инженерные системы",
    "Электрика, водоснабжение, канализация и вентиляция",
  ],
  finishing: [
    "Отделка",
    "Внутренняя и наружная комплектация с точными площадями",
  ],
  delivery: [
    "Доставка и логистика",
    "Рейсы, расстояние, объём и погрузочно-разгрузочные работы",
  ],
};

function SectionResult({ calculation, sectionKey }) {
  const { project, commit } = useProject();
  const section = calculation.sections.find((item) => item.key === sectionKey);
  const lines = section?.lines || [];
  const hiddenCount = (project.estimateOverrides || []).filter(
    (item) => item.section === sectionKey && item.excluded,
  ).length;
  return (
    <EditableEstimateTable
      lines={lines}
      hiddenCount={hiddenCount}
      onChangeLine={(line, changes) =>
        commit((next) => {
          changeEstimateLine(next, line, changes);
          return next;
        })
      }
      onRemoveLine={(line) =>
        commit((next) => {
          removeEstimateLine(next, line);
          return next;
        })
      }
      onResetLine={(line) =>
        commit((next) => {
          resetEstimateLine(next, line.id);
          return next;
        })
      }
      onAddLine={() =>
        commit((next) => {
          addEstimateLine(next, sectionKey);
          return next;
        })
      }
      onResetSection={() =>
        commit((next) => {
          resetEstimateSection(next, sectionKey);
          return next;
        })
      }
    />
  );
}

function RafterSystemPreview({ calculation }) {
  const roof = calculation.roof;
  const structure = roof.rafterStructure || {};
  const count = Math.max(2, structure.pairCount || 2);
  const planRafters = Array.from({ length: count }, (_, index) => 370 + index * (318 / Math.max(1, count - 1)));
  const layered = structure.system === "layered";
  const truss = structure.system === "truss";
  const systemLabel = layered ? "Наслонная" : truss ? "Стропильная ферма" : structure.system === "flat" ? "Балки плоской кровли" : "Висячая";
  return (
    <div className="rafter-scheme">
      <svg viewBox="0 0 760 220" role="img" aria-label="Схема стропильной системы">
        <g className="roof-scheme-house">
          <rect x="45" y="135" width="250" height="52" />
          <line x1="35" y1="135" x2="170" y2="38" />
          <line x1="170" y1="38" x2="305" y2="135" />
          <rect className="roof-scheme-mauerlat" x="48" y="127" width="18" height="8" />
          <rect className="roof-scheme-mauerlat" x="274" y="127" width="18" height="8" />
          <rect className="roof-scheme-ridge-block" x="166" y="32" width="8" height="14" />
          {layered ? <>
            <rect className="roof-scheme-mauerlat" x="155" y="127" width="30" height="8" />
            <line className="roof-scheme-support" x1="170" y1="46" x2="170" y2="127" />
            <line className="roof-scheme-support" x1="170" y1="121" x2="108" y2="83" />
            <line className="roof-scheme-support" x1="170" y1="121" x2="232" y2="83" />
          </> : truss ? <>
            <line className="roof-scheme-support" x1="48" y1="127" x2="292" y2="127" />
            <line className="roof-scheme-support" x1="170" y1="42" x2="170" y2="127" />
            <line className="roof-scheme-support" x1="105" y1="85" x2="170" y2="127" />
            <line className="roof-scheme-support" x1="235" y1="85" x2="170" y2="127" />
          </> : <line className="roof-scheme-support" x1="84" y1="100" x2="256" y2="100" />}
          <text x="170" y="207" textAnchor="middle">{layered ? "Наслонная · прогон, стойка и подкосы" : truss ? "Стропильная ферма · пояс и решётка" : "Висячая система · поднятая затяжка A-frame"}</text>
        </g>
        <g className="roof-scheme-plan">
          <rect x="370" y="38" width="318" height="149" />
          <line className="roof-scheme-mauerlat-line" x1="374" y1="45" x2="684" y2="45" />
          <line className="roof-scheme-mauerlat-line" x1="374" y1="180" x2="684" y2="180" />
          <line className="roof-scheme-ridge" x1="370" y1="112" x2="688" y2="112" />
          {planRafters.map((x) => <line key={x} x1={x} y1="38" x2={x} y2="187" />)}
          <text x="529" y="207" textAnchor="middle">{structure.pairCount || 0} пар · шаг {formatNumber(structure.step || 0.6)} м</text>
        </g>
      </svg>
      <div className="rafter-scheme-summary">
        <div><span>Система</span><strong>{systemLabel}</strong></div>
        <div><span>Стропильные ноги</span><strong>{structure.legCount || 0} шт · {formatNumber(roof.rafterLegLength)} м</strong></div>
        <div><span>Закупка</span><strong>{roof.rafterBoardCount || 0} досок × 6 м</strong></div>
        <div><span>Конёк</span><strong>{roof.mainRoofShape === "flat" ? "не применяется" : `${formatNumber(roof.ridgeBeamLength)} м · всегда включён`}</strong></div>
      </div>
      <p className="inspector-note">Схема служит для расчёта комплектации. Несущую способность и узлы крепления необходимо подтвердить конструктивным проектом.</p>
    </div>
  );
}

function RoofConstructionPanels({
  project,
  calculation,
  setSetting,
  setPlatformRoof,
}) {
  return (
    <>
      <Panel
        title="Конструктив кровли"
        description="В автоматическом режиме система, шаг и сечение подбираются из геометрии плана. Переключитесь на ручной режим, чтобы изменить конструктив проекта."
      >
        <div className="form-grid four">
          <SelectField
            label="Режим расчёта"
            value={project.settings.roof.structureMode || "auto"}
            onChange={(value) => setSetting("roof", "structureMode", value)}
            options={[{ value: "auto", label: "Автоматически по плану" }, { value: "manual", label: "Ручная настройка" }]}
          />
          <SelectField
            label="Тип стропильной системы"
            value={(project.settings.roof.structureMode || "auto") === "auto" ? calculation.roof.rafterStructure.system : (project.settings.roof.rafterSystem || "hanging")}
            disabled={(project.settings.roof.structureMode || "auto") === "auto"}
            onChange={(value) => setSetting("roof", "rafterSystem", value)}
            options={[{ value: "hanging", label: "Висячая · без внутренней опоры" }, { value: "layered", label: "Наслонная · с опорой" }, { value: "truss", label: "Стропильная ферма" }]}
          />
          <NumberField
            label="Чистый шаг между стропилами"
            value={(project.settings.roof.structureMode || "auto") === "auto" ? calculation.roof.rafterStructure.step : project.settings.roof.rafterStep}
            suffix="м" min={0.3} max={1.2} step={0.05}
            disabled={(project.settings.roof.structureMode || "auto") === "auto"}
            onChange={(value) => setSetting("roof", "rafterStep", value)}
          />
          <SelectField
            label="Стропильная доска"
            value={(project.settings.roof.structureMode || "auto") === "auto" ? calculation.roof.rafterStructure.section : (project.settings.roof.rafterSection || "50x150")}
            disabled={(project.settings.roof.structureMode || "auto") === "auto"}
            onChange={(value) => setSetting("roof", "rafterSection", value)}
            options={[
              { value: "50x100", label: "50×100 мм" },
              { value: "50x150", label: "50×150 мм" },
              { value: "50x200", label: "50×200 мм" },
            ]}
          />
          <NumberField
            label="Шаг обрешётки"
            value={project.settings.roof.lathStep ?? 0.35}
            suffix="м" min={0.1} max={1.2} step={0.05}
            onChange={(value) => setSetting("roof", "lathStep", value)}
          />
          <SelectField
            label="Доска обрешётки"
            value={project.settings.roof.lathSection || "25x100"}
            onChange={(value) => setSetting("roof", "lathSection", value)}
            options={[{ value: "25x100", label: "25×100 мм" }, { value: "25x150", label: "25×150 мм" }]}
          />
          {project.settings.roof.shape !== "flat" ? <>
            <SelectField
              label="Фронтоны основной крыши"
              value={project.settings.roof.gableType || "auto"}
              onChange={(value) => setSetting("roof", "gableType", value)}
              options={[
                { value: "auto", label: "По типу кровли" },
                { value: "cold", label: "Холодные каркасные" },
                { value: "sip", label: "Тёплые SIP" },
                { value: "none", label: "Не учитывать" },
              ]}
            />
            <NumberField
              label="Количество фронтонов"
              value={project.settings.roof.gableCount ?? 2}
              suffix="шт"
              min={0}
              max={2}
              step={1}
              onChange={(value) =>
                setSetting("roof", "gableCount", Math.round(value))
              }
            />
          </> : null}
          <div className="readout">
            <span>Площадь фронтонов</span>
            <strong>{formatNumber(calculation.roof.gableArea)} м²</strong>
          </div>
          <div className="readout">
            <span>Столбы пристроек</span>
            <strong>{calculation.roof.terracePostCount} шт</strong>
          </div>
          <div className="readout">
            <span>Стропильные пары</span>
            <strong>{calculation.roof.rafterStructure.pairCount} шт · модуль {formatNumber(calculation.roof.rafterStructure.module, 2)} м</strong>
          </div>
          <div className="readout">
            <span>Обрешётка</span>
            <strong>{calculation.roof.mainLathBoardCount} досок × 6 м</strong>
          </div>
        </div>
        <RafterSystemPreview calculation={calculation} />
      </Panel>
      <Panel
        title="Доборные элементы"
        description="Коньковая планка и её монтаж всегда входят в двускатную кровлю. Остальные элементы можно включать и выключать; материалы и работы сразу меняются в ведомости и смете."
      >
        <div className="toggle-grid roof-accessory-grid">
          <Toggle label="Карнизные планки" hint={`${formatNumber(calculation.roof.mainEaveTrimPurchaseLength)} м с запасом`} checked={project.settings.roof.includeEaveTrim !== false} onChange={(value) => setSetting("roof", "includeEaveTrim", value)} />
          <Toggle label="Торцевые (ветровые) планки" hint={`${formatNumber(calculation.roof.mainVergeTrimPurchaseLength)} м с запасом`} checked={project.settings.roof.includeVergeTrim !== false} onChange={(value) => setSetting("roof", "includeVergeTrim", value)} />
          <Toggle label="Уплотнитель под конёк" hint="Коньковая планка при этом остаётся" checked={project.settings.roof.includeRidgeSeal !== false} onChange={(value) => setSetting("roof", "includeRidgeSeal", value)} />
          <Toggle label="Водосточная система" hint={project.settings.roof.includeGutter === true ? `${formatNumber(calculation.roof.gutterLength)} м жёлоба · ${calculation.roof.gutterOutlets} выпуска` : "Жёлоба, трубы, крепёж и монтаж"} checked={project.settings.roof.includeGutter === true} onChange={(value) => setSetting("roof", "includeGutter", value)} />
          <div className="fixed-roof-accessory"><span>Коньковая планка</span><strong>Обязательно · {formatNumber(calculation.roof.ridgeBeamLength)} м</strong></div>
        </div>
      </Panel>
      <Panel
        title="Настройка кровель террас и крыльца"
        description="Кровля каждой площадки включается здесь. Площадь, фронтоны, конёк и опорные столбы сразу переходят в общую ведомость кровли."
      >
        {calculation.roof.terraceRoofs.length ? (
          <div className="terrace-roof-editors">
            {calculation.roof.terraceRoofs.map(({ platform, result }) => (
              <article className="terrace-roof-editor" key={platform.id}>
                <header>
                  <div>
                    <strong>
                      {platform.kind === "porch" ? "Крыльцо" : "Терраса"} ·{" "}
                      {formatNumber(platform.w * platform.h)} м²
                    </strong>
                    <span>
                      {result.netArea
                        ? `Кровля ${formatNumber(result.netArea)} м²`
                        : "Кровля отключена"}
                    </span>
                  </div>
                  {result.postCount ? (
                    <small>
                      {result.postCount} столбов{" "}
                      {result.postSection.replace("x", "×")} мм
                    </small>
                  ) : null}
                </header>
                <div className="form-grid four">
                  <SelectField
                    label="Кровля"
                    value={platform.roof.mode}
                    onChange={(value) =>
                      setPlatformRoof(platform.id, "mode", value)
                    }
                    options={[
                      { value: "none", label: "Без кровли" },
                      { value: "cold", label: "Холодная" },
                      { value: "warm", label: "Тёплая SIP" },
                    ]}
                  />
                  {platform.roof.mode !== "none" ? (
                    <>
                      <SelectField
                        label="Форма"
                        value={platform.roof.shape}
                        onChange={(value) =>
                          setPlatformRoof(platform.id, "shape", value)
                        }
                        options={[
                          { value: "shed", label: "Односкатная" },
                          {
                            value: "continuation",
                            label: "Продолжение основной",
                          },
                          { value: "gable", label: "Двускатная" },
                        ]}
                      />
                      <SelectField
                        label="Сечение столбов"
                        value={platform.roof.postSection || "auto"}
                        onChange={(value) =>
                          setPlatformRoof(platform.id, "postSection", value)
                        }
                        options={[
                          { value: "auto", label: "Автоматически" },
                          { value: "100x100", label: "100×100 мм" },
                          { value: "150x100", label: "150×100 мм" },
                        ]}
                      />
                      <NumberField
                        label="Запас покрытия"
                        value={platform.roof.wastePercent}
                        suffix="%"
                        step={1}
                        onChange={(value) =>
                          setPlatformRoof(platform.id, "wastePercent", value)
                        }
                      />
                      <NumberField
                        label="Свес спереди"
                        value={platform.roof.frontOverhang}
                        suffix="м"
                        step={0.05}
                        onChange={(value) =>
                          setPlatformRoof(platform.id, "frontOverhang", value)
                        }
                      />
                      <NumberField
                        label="Боковой свес"
                        value={platform.roof.sideOverhang}
                        suffix="м"
                        step={0.05}
                        onChange={(value) =>
                          setPlatformRoof(platform.id, "sideOverhang", value)
                        }
                      />
                      {platform.roof.shape === "gable" ? (
                        <>
                          <NumberField
                            label="Высота конька"
                            value={platform.roof.ridgeHeight}
                            suffix="м"
                            step={0.1}
                            onChange={(value) =>
                              setPlatformRoof(platform.id, "ridgeHeight", value)
                            }
                          />
                          <SelectField
                            label="Фронтон"
                            value={platform.roof.gableType || "auto"}
                            onChange={(value) =>
                              setPlatformRoof(platform.id, "gableType", value)
                            }
                            options={[
                              { value: "auto", label: "По типу кровли" },
                              { value: "cold", label: "Холодный" },
                              { value: "sip", label: "Тёплый SIP" },
                              { value: "none", label: "Без фронтона" },
                            ]}
                          />
                          <NumberField
                            label="Количество фронтонов"
                            value={platform.roof.gableCount ?? 1}
                            suffix="шт"
                            min={0}
                            max={2}
                            step={1}
                            onChange={(value) =>
                              setPlatformRoof(
                                platform.id,
                                "gableCount",
                                Math.round(value),
                              )
                            }
                          />
                        </>
                      ) : (
                        <>
                          <NumberField
                            label="Высота у стены"
                            value={platform.roof.highHeight}
                            suffix="м"
                            step={0.1}
                            onChange={(value) =>
                              setPlatformRoof(platform.id, "highHeight", value)
                            }
                          />
                          <NumberField
                            label="Высота края"
                            value={platform.roof.lowHeight}
                            suffix="м"
                            step={0.1}
                            onChange={(value) =>
                              setPlatformRoof(platform.id, "lowHeight", value)
                            }
                          />
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            Сначала добавьте террасу или крыльцо на плане дома.
          </div>
        )}
      </Panel>
    </>
  );
}

export default function Calculators({ type }) {
  const { project: sourceProject, commit } = useProject();
  const calculation = useMemo(
    () => calculateProject(sourceProject),
    [sourceProject],
  );
  const project = useMemo(
    () => ({
      ...sourceProject,
      settings: {
        ...sourceProject.settings,
        roof: {
          ...sourceProject.settings.roof,
          ridgeLength: calculation.inputs.roof.ridgeLength,
        },
        engineering: calculation.inputs.engineering,
        internal: {
          ...sourceProject.settings.internal,
          ...calculation.inputs.internal,
        },
        external: {
          ...sourceProject.settings.external,
          ...calculation.inputs.external,
        },
        delivery: {
          ...sourceProject.settings.delivery,
          cargoVolume: calculation.inputs.delivery.cargoVolume,
        },
      },
    }),
    [sourceProject, calculation.inputs],
  );
  const setSetting = (group, key, value) =>
    commit((next) => {
      next.settings[group][key] = value;
      if (group === "engineering")
        next.settings.links.engineeringFromPlan = false;
      if (group === "internal")
        next.settings.links.internalFinishFromPlan = false;
      if (group === "external")
        next.settings.links.externalFinishFromPlan = false;
      if (group === "roof" && key === "ridgeLength")
        next.settings.links.roofRidgeFromPlan = false;
      if (group === "delivery" && key === "cargoVolume")
        next.settings.links.deliveryVolumeFromPlan = false;
      return next;
    });
  const setService = (key, value) =>
    commit((next) => {
      next.services[key] = value;
      return next;
    });
  const setPlatformRoof = (platformId, key, value) =>
    commit((next) => {
      const platform = next.plan.platforms.find(
        (item) => item.id === platformId,
      );
      if (platform?.roof) platform.roof[key] = value;
      return next;
    });
  const [title, description] = TITLES[type] || TITLES.piles;
  return (
    <div className="screen">
      <ScreenHeader title={title} description={description} />
      <div className="calculation-link-banner">
        <strong>Данные связаны с планом</strong>
        <span>
          Поля с расчётными значениями обновляются автоматически. Ручное
          изменение такого поля отключает соответствующую связь; включить её
          снова можно кнопкой ⚙ вверху.
        </span>
      </div>
      {type === "piles" ? (
        <>
          <div className="stats-row">
            <Stat
              label="Сваи дома"
              value={`${calculation.foundation.housePiles} шт`}
            />
            <Stat
              label="Сваи пристроек"
              value={`${calculation.foundation.platformPiles} шт`}
            />
            <Stat
              label="Общие сваи"
              value={`${calculation.foundation.sharedPiles} шт`}
              tone="accent"
            />
            <Stat
              label="Всего уникальных"
              value={`${calculation.foundation.totalPiles} шт`}
            />
            <Stat
              label="Обвязка"
              value={`${formatNumber(calculation.foundation.bindingLength)} м`}
            />
            <Stat
              label="Доски по 6 м"
              value={`${calculation.foundation.boardCount} шт`}
            />
            <Stat
              label="Объём доски"
              value={`${formatNumber(calculation.foundation.boardVolume, 3)} м³`}
            />
          </div>
          <Panel title="Параметры основания">
            <div className="form-grid three">
              <NumberField
                label="Предельный шаг свай"
                value={project.settings.piles.spacing}
                suffix="м"
                min={0.5}
                onChange={(value) => setSetting("piles", "spacing", value)}
              />
              <NumberField
                label="Слоёв доски 50×150"
                value={project.settings.piles.bindingLayers || 3}
                suffix="шт"
                min={1}
                max={6}
                step={1}
                onChange={(value) =>
                  setSetting("piles", "bindingLayers", Math.max(1, Math.round(value)))
                }
              />
              <div className="readout"><span>Закупочная длина</span><strong>{formatNumber(calculation.foundation.purchaseBoardLength)} м · {calculation.foundation.boardCount} × 6 м</strong></div>
              <div className="readout"><span>Запас / обрезки</span><strong>{formatNumber(calculation.foundation.boardWasteLength)} м</strong></div>
              <Toggle
                label="Включить в смету"
                checked={project.services.foundation}
                onChange={(value) => setService("foundation", value)}
              />
            </div>
          </Panel>
          <Panel title="Ведомость фундамента">
            <SectionResult calculation={calculation} sectionKey="foundation" />
          </Panel>
        </>
      ) : null}
      {type === "sip" ? (
        <>
          <div className="stats-row">
            <Stat
              label="Пол всего дома"
              value={`${formatNumber(calculation.metrics.floorArea)} м²`}
            />
            <Stat
              label="Наружные стены"
              value={`${formatNumber(calculation.metrics.exteriorWallNetArea)} м²`}
            />
            <Stat
              label="СИП-потолок"
              value={`${formatNumber(calculation.metrics.ceilingArea)} м²`}
            />
            <Stat
              label="Стыки панелей"
              value={`${formatNumber(calculation.sip.joinery.totalJointLength)} м`}
              tone="accent"
            />
            <Stat
              label="Торцевая доска"
              value={`${formatNumber(calculation.sip.joinery.totalEndBoardLength)} м`}
            />
            <Stat
              label="Перегородки"
              value={`${formatNumber(calculation.metrics.partitionNetArea)} м²`}
            />
          </div>
          <Panel
            title="Панели и силовой каркас"
            description="Для всех трёх вариантов используется одна расчётная длина стыков в погонных метрах. Тип каркаса меняет номенклатуру и цену, а размер автоматически выбирается по толщине SIP-панели."
          >
            <div className="form-grid four">
              <SelectField
                label="Панель пола"
                value={project.settings.sip.floorThickness}
                onChange={(value) => setSetting("sip", "floorThickness", value)}
                options={["124", "174", "224"].map((value) => ({
                  value,
                  label: `${value} мм`,
                }))}
              />
              <SelectField
                label="Панель стен"
                value={project.settings.sip.wallThickness}
                onChange={(value) => setSetting("sip", "wallThickness", value)}
                options={["124", "174", "224"].map((value) => ({
                  value,
                  label: `${value} мм`,
                }))}
              />
              <SelectField
                label="Панель потолка"
                value={project.settings.sip.ceilingThickness}
                onChange={(value) =>
                  setSetting("sip", "ceilingThickness", value)
                }
                options={["124", "174", "224"].map((value) => ({
                  value,
                  label: `${value} мм`,
                }))}
              />
              <SelectField
                label="Тип силового каркаса"
                value={project.settings.sip.connectorType || "thermal"}
                onChange={(value) => setSetting("sip", "connectorType", value)}
                options={SIP_JOINERY_TYPES}
              />
              <SelectField
                label="Раскладка панелей пола"
                value={project.settings.sip.floorPanelWidth || "1.25"}
                onChange={(value) => setSetting("sip", "floorPanelWidth", value)}
                options={[
                  { value: "1.25", label: "1250 × 2500 мм · стандарт" },
                  { value: "0.625", label: "625 × 2500 мм · усиленная" },
                ]}
              />
              <SelectField
                label="Шаг панелей потолка"
                value={project.settings.sip.ceilingPanelWidth || "1.25"}
                onChange={(value) => setSetting("sip", "ceilingPanelWidth", value)}
                options={[
                  { value: "1.25", label: "1250 мм · стандарт" },
                  { value: "0.625", label: "625 мм · усиленный" },
                ]}
              />
              <NumberField
                label="Дополнительный запас панелей"
                value={project.settings.sip.wastePercent}
                suffix="%"
                step={1}
                onChange={(value) => setSetting("sip", "wastePercent", value)}
              />
            </div>
            <p className="panel-note">При шаге 625 мм каждая целая панель 1250 × 2500 мм распускается вдоль на две части. Покупное количество панелей не удваивается, а продольный рез и дополнительные стыки силового каркаса рассчитываются автоматически.</p>
            <div className="frame-type-guide">
              <article><strong>1. Термобрус</strong><span>95×95 · 95×145 · 95×195 мм</span><small>Премиальный и самый дорогой вариант</small></article>
              <article><strong>2. Клеёный пакет досок</strong><span>95×95 · 95×145 · 95×195 мм</span><small>Средний вариант, цена 50% термобруса</small></article>
              <article><strong>3. Брус естественной влажности</strong><span>100×100 · 100×150 · 100×200 мм</span><small>Экономичный вариант, цена доски пересчитана за 1 м.п.</small></article>
            </div>
            <div className="toggle-grid">
              <Toggle
                label="СИП-пол"
                checked={project.services.sipFloor}
                onChange={(value) => setService("sipFloor", value)}
              />
              <Toggle
                label="Наружные стены"
                checked={project.services.sipWalls}
                onChange={(value) => setService("sipWalls", value)}
              />
              <Toggle
                label="СИП-потолок"
                checked={project.services.sipCeiling}
                onChange={(value) => setService("sipCeiling", value)}
              />
              <Toggle
                label="Каркасные перегородки"
                checked={project.services.partitions}
                onChange={(value) => setService("partitions", value)}
              />
            </div>
          </Panel>
          <Panel
            title="Раскрой СИП-панелей"
            description="Только пол, наружные стены и горизонтальный потолок. Крыша рассчитывается во вкладке «Кровля», каркасные перегородки не раскраиваются."
          >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Конструкция</th>
                    <th>Чистая площадь</th>
                    <th>Панели</th>
                    <th>Шаг</th>
                    <th>Куплено</th>
                    <th>Остаток</th>
                    <th>Рез</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.sip.cutting.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{formatNumber(row.area)} м²</td>
                      <td>{row.panels} шт</td>
                      <td>{Math.round(row.layoutWidth * 1000)} мм{row.splitCutMeters > 0 ? ` · продольный рез ${formatNumber(row.splitCutMeters)} м` : ''}</td>
                      <td>{formatNumber(row.purchasedArea)} м²</td>
                      <td>{formatNumber(row.offcutArea)} м²</td>
                      <td>{formatNumber(row.cutMeters)} м</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Ведомость СИП и каркасных перегородок">
            <SectionResult calculation={calculation} sectionKey="sip" />
          </Panel>
        </>
      ) : null}
      {type === "roof" ? (
        <RoofConstructionPanels
          project={project}
          calculation={calculation}
          setSetting={setSetting}
          setPlatformRoof={setPlatformRoof}
        />
      ) : null}
      {type === "roof" ? (
        <>
          <div className="stats-row">
            <Stat
              label="Основная кровля"
              value={`${formatNumber(calculation.roof.geometry?.totalSlopeArea)} м²`}
            />
            <Stat
              label="Холодная / стропила"
              value={`${formatNumber(calculation.roof.coldArea)} м²`}
            />
            <Stat
              label="Тёплая СИП"
              value={`${formatNumber(calculation.roof.warmArea)} м²`}
            />
            <Stat
              label="СИП-панели кровли"
              value={`${calculation.roof.sipCutting?.panels || 0} шт`}
            />
            <Stat
              label="Утепление второго света"
              value={`${formatNumber(calculation.roof.insulatedRafterArea)} м²`}
              tone={calculation.roof.insulatedRafterArea ? "accent" : ""}
            />
            <Stat
              label="Мауэрлат 100×150"
              value={`${formatNumber(calculation.roof.mauerlatLength)} м.п.`}
            />
            <Stat
              label="Коньковая доска в стропилах"
              value={`${formatNumber(calculation.roof.ridgeBeamLength)} м.п.`}
            />
            <Stat
              label="Доборы свесов"
              value={`${formatNumber((project.settings.roof.includeEaveTrim === false ? 0 : calculation.roof.mainEaveLength || 0) + (project.settings.roof.includeVergeTrim === false ? 0 : calculation.roof.mainVergeLength || 0))} м.п.`}
            />
            <Stat
              label="Всего"
              value={`${formatNumber(calculation.roof.totalArea)} м²`}
            />
          </div>
          <Panel
            title="Основная крыша"
            description="Мауэрлат 100×150 считается отдельно по двум опорным стенам. Коньковый прогон выполняется из доски того же сечения, что и стропила, и включён в общий объём стропильной доски. Карнизные и ветровые планки считаются по краям свесов."
          >
            <div className="form-grid four">
              <SelectField
                label="Форма основной кровли"
                value={project.settings.roof.shape || "gable"}
                onChange={(value) => setSetting("roof", "shape", value)}
                options={[
                  { value: "gable", label: "Двускатная" },
                  { value: "flat", label: "Плоская" },
                ]}
              />
              <SelectField
                label="Тип"
                value={project.settings.roof.type}
                onChange={(value) => setSetting("roof", "type", value)}
                options={[
                  { value: "cold", label: "Холодная" },
                  { value: "sip", label: "Тёплая СИП" },
                  { value: "combo", label: "Комбинированная" },
                ]}
              />
              {project.settings.roof.shape !== "flat" ? <NumberField
                  label="Высота конька"
                  value={project.settings.roof.ridgeHeight}
                  suffix="м"
                  onChange={(value) => setSetting("roof", "ridgeHeight", value)}
                /> : null}
              <NumberField
                label={project.settings.roof.shape === "flat" ? "Длина кровли" : "Длина конька"}
                value={project.settings.roof.ridgeLength}
                suffix="м"
                onChange={(value) => setSetting("roof", "ridgeLength", value)}
              />
              <NumberField
                label="Запас покрытия"
                value={project.settings.roof.wastePercent}
                suffix="%"
                step={1}
                onChange={(value) => setSetting("roof", "wastePercent", value)}
              />
              <NumberField
                label="Карнизный свес · слева и справа"
                value={project.settings.roof.eaveOverhang ?? 0.5}
                suffix="м"
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => setSetting("roof", "eaveOverhang", value)}
              />
              <NumberField
                label="Торцевой свес · спереди и сзади"
                value={project.settings.roof.gableOverhang ?? 0.3}
                suffix="м"
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => setSetting("roof", "gableOverhang", value)}
              />
              <div className="readout">
                <span>Габарит кровли со свесами</span>
                <strong>{formatNumber(calculation.roof.geometry?.roofLength)} × {formatNumber(calculation.roof.geometry?.roofSpan)} м</strong>
              </div>
              {project.settings.roof.type === "combo" ? (
                <NumberField
                  label="Тёплая часть"
                  value={project.settings.roof.warmPercent}
                  suffix="%"
                  max={100}
                  step={5}
                  onChange={(value) => setSetting("roof", "warmPercent", value)}
                />
              ) : null}
            </div>
          </Panel>
          <Panel title="Кровли пристроек">
            {calculation.roof.terraceRoofs.map(({ platform, result }) => (
              <div className="calculation-row" key={platform.id}>
                <div>
                  <strong>
                    {platform.kind === "porch" ? "Крыльцо" : "Терраса"} ·{" "}
                    {formatNumber(platform.w * platform.h)} м²
                  </strong>
                  <span>
                    {platform.roof.mode === "none"
                      ? "без кровли"
                      : platform.roof.mode === "cold"
                        ? "холодная"
                        : "тёплая СИП"}
                  </span>
                </div>
                <strong>
                  {formatNumber(result.netArea)} м²{" "}
                  <small>
                    · с запасом {formatNumber(result.purchaseArea)} м²
                  </small>
                </strong>
              </div>
            ))}
          </Panel>
          <Panel
            title="Материалы кровли террас и крыльца"
            description="Каждая пристройка показана отдельными строками и этими же позициями входит в общую смету кровли."
          >
            {calculation.roof.extensionLines?.some(
              (line) => line.kind === "material",
            ) ? (
              <PreviewTable
                lines={calculation.roof.extensionLines.filter(
                  (line) => line.kind === "material",
                )}
              />
            ) : (
              <p className="inspector-note">
                На плане пока нет террасы или крыльца с включённой кровлей.
              </p>
            )}
          </Panel>
          <Panel title="Ведомость кровли">
            <SectionResult calculation={calculation} sectionKey="roof" />
          </Panel>
        </>
      ) : null}
      {type === "terrace" ? (
        <>
          <div className="stats-row">
            <Stat
              label="Площадок"
              value={`${project.plan.platforms.length} шт`}
            />
            <Stat
              label="Площадь настила"
              value={`${formatNumber(calculation.terrace.area)} м²`}
            />
            <Stat
              label="Ступеней"
              value={`${project.plan.platforms.reduce((sum, item) => sum + (item.steps || 0), 0)} шт`}
            />
            <Stat
              label="Сваи пристроек"
              value={`${calculation.foundation.platformPiles} шт`}
            />
          </div>
          <Panel title="Площадки проекта">
            {project.plan.platforms.map((platform) => {
              const result = calculateTerraceRoof(platform, project.plan.house);
              return (
                <div className="calculation-row" key={platform.id}>
                  <div>
                    <strong>
                      {platform.kind === "porch" ? "Крыльцо" : "Терраса"} ·{" "}
                      {formatNumber(platform.w * platform.h)} м²
                    </strong>
                    <span>
                      {platform.foundation.mode === "shared"
                        ? "общее свайное поле"
                        : platform.foundation.mode === "separate"
                          ? "отдельные сваи"
                          : "без свай"}{" "}
                      ·{" "}
                      {platform.binding.mode === "shared"
                        ? "общая обвязка"
                        : platform.binding.mode === "separate"
                          ? "отдельная обвязка"
                          : "без обвязки"}
                    </span>
                  </div>
                  <strong>
                    {platform.roof.mode === "none"
                      ? "Без кровли"
                      : `${formatNumber(result.netArea)} м² кровли`}
                  </strong>
                </div>
              );
            })}
          </Panel>
          <Panel title="Ведомость террасы">
            <SectionResult calculation={calculation} sectionKey="terrace" />
          </Panel>
        </>
      ) : null}
      {type === "openings" ? (
        <>
          <div className="stats-row">
            <Stat
              label="Окна"
              value={`${project.plan.openings.filter((item) => item.type === "window").length} шт`}
            />
            <Stat
              label="Двери"
              value={`${project.plan.openings.filter((item) => item.type === "door" && item.doorType !== "garage").length} шт`}
            />
            <Stat
              label="Гаражные ворота"
              value={`${project.plan.openings.filter((item) => item.type === "door" && item.doorType === "garage").length} шт`}
            />
            <Stat
              label="Общая площадь"
              value={`${formatNumber(calculation.metrics.totalOpeningsArea)} м²`}
            />
          </div>
          <Panel title="Проёмы с плана">
            <div className="calculation-list">
              {project.plan.openings.map((opening) => (
                <div className="calculation-row" key={opening.id}>
                  <div>
                    <strong>
                      {opening.type === "window"
                        ? "Окно"
                        : opening.doorType === "garage"
                          ? "Гаражные ворота"
                          : opening.doorType === "interior"
                            ? "Межкомнатная дверь"
                            : "Входная дверь"}
                    </strong>
                    <span>
                      {Math.round(opening.width * 1000)} ×{" "}
                      {Math.round(opening.height * 1000)} мм
                    </span>
                  </div>
                  <strong>
                    {formatNumber(opening.width * opening.height, 2)} м²
                  </strong>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Ведомость проёмов">
            <SectionResult calculation={calculation} sectionKey="openings" />
          </Panel>
        </>
      ) : null}
      {type === "engineering" ? (
        <>
          <Panel title="Выбор инженерных систем">
            <div className="toggle-grid">
              <Toggle
                label="Электрика"
                checked={project.services.engineeringElectric}
                onChange={(value) => setService("engineeringElectric", value)}
              />
              <Toggle
                label="Водоснабжение"
                checked={project.services.engineeringPlumbing}
                onChange={(value) => setService("engineeringPlumbing", value)}
              />
              <Toggle
                label="Канализация"
                checked={project.services.engineeringSewerage}
                onChange={(value) => setService("engineeringSewerage", value)}
              />
              <Toggle
                label="Вентиляция"
                checked={project.services.engineeringVentilation}
                onChange={(value) =>
                  setService("engineeringVentilation", value)
                }
              />
            </div>
            <div className="form-grid four">
              <NumberField
                label="Кабельные трассы"
                value={project.settings.engineering.cableRoute}
                suffix="м"
                onChange={(value) =>
                  setSetting("engineering", "cableRoute", value)
                }
              />
              <NumberField
                label="Электроточки"
                value={project.settings.engineering.electricPoints}
                suffix="шт"
                step={1}
                onChange={(value) =>
                  setSetting("engineering", "electricPoints", value)
                }
              />
              <NumberField
                label="Водопровод"
                value={project.settings.engineering.waterPipe}
                suffix="м"
                onChange={(value) =>
                  setSetting("engineering", "waterPipe", value)
                }
              />
              <NumberField
                label="Точки воды"
                value={project.settings.engineering.waterPoints}
                suffix="шт"
                step={1}
                onChange={(value) =>
                  setSetting("engineering", "waterPoints", value)
                }
              />
              <NumberField
                label="Канализация"
                value={project.settings.engineering.sewerLength}
                suffix="м"
                onChange={(value) =>
                  setSetting("engineering", "sewerLength", value)
                }
              />
              <NumberField
                label="Точки канализации"
                value={project.settings.engineering.sewerPoints}
                suffix="шт"
                step={1}
                onChange={(value) =>
                  setSetting("engineering", "sewerPoints", value)
                }
              />
              <NumberField
                label="Воздуховоды"
                value={project.settings.engineering.ventDuct}
                suffix="м"
                onChange={(value) =>
                  setSetting("engineering", "ventDuct", value)
                }
              />
              <NumberField
                label="Решётки"
                value={project.settings.engineering.ventGrilles}
                suffix="шт"
                step={1}
                onChange={(value) =>
                  setSetting("engineering", "ventGrilles", value)
                }
              />
            </div>
          </Panel>
          <Panel title="Ведомость инженерии">
            <SectionResult calculation={calculation} sectionKey="engineering" />
          </Panel>
        </>
      ) : null}
      {type === "finishing" ? (
        <>
          <div className="two-column-layout">
            <Panel title="Внутренняя отделка">
              <Toggle
                label="Включить раздел"
                checked={project.services.internalFinish}
                onChange={(value) => setService("internalFinish", value)}
              />
              <div className="form-grid">
                <NumberField
                  label="Стены"
                  value={project.settings.internal.wallArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("internal", "wallArea", value)
                  }
                />
                <NumberField
                  label="Потолок"
                  value={project.settings.internal.ceilingArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("internal", "ceilingArea", value)
                  }
                />
                <NumberField
                  label="Ламинат"
                  value={project.settings.internal.laminateArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("internal", "laminateArea", value)
                  }
                />
                <NumberField
                  label="Плитка"
                  value={project.settings.internal.tileArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("internal", "tileArea", value)
                  }
                />
                <NumberField
                  label="Двери"
                  value={project.settings.internal.doors}
                  suffix="шт"
                  step={1}
                  onChange={(value) => setSetting("internal", "doors", value)}
                />
              </div>
            </Panel>
            <Panel title="Наружная отделка">
              <Toggle
                label="Включить раздел"
                checked={project.services.externalFinish}
                onChange={(value) => setService("externalFinish", value)}
              />
              <div className="form-grid">
                <NumberField
                  label="Фасад"
                  value={project.settings.external.facadeArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("external", "facadeArea", value)
                  }
                />
                <NumberField
                  label="Ветрозащита"
                  value={project.settings.external.windArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("external", "windArea", value)
                  }
                />
                <NumberField
                  label="Утепление"
                  value={project.settings.external.insulationArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("external", "insulationArea", value)
                  }
                />
                <NumberField
                  label="Профлист"
                  value={project.settings.external.metalArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("external", "metalArea", value)
                  }
                />
                <NumberField
                  label="Подшива"
                  value={project.settings.external.soffitArea}
                  suffix="м²"
                  onChange={(value) =>
                    setSetting("external", "soffitArea", value)
                  }
                />
              </div>
            </Panel>
          </div>
          <Panel title="Внутренняя ведомость">
            <SectionResult calculation={calculation} sectionKey="internal" />
          </Panel>
          <Panel title="Наружная ведомость">
            <SectionResult calculation={calculation} sectionKey="external" />
          </Panel>
        </>
      ) : null}
      {type === "delivery" ? (
        <>
          <Panel title="Логистика">
            <div className="form-grid four">
              <NumberField
                label="Расстояние"
                value={project.settings.delivery.distance}
                suffix="км"
                onChange={(value) => setSetting("delivery", "distance", value)}
              />
              <NumberField
                label="Количество рейсов"
                value={project.settings.delivery.trips}
                suffix="рейс"
                step={1}
                onChange={(value) => setSetting("delivery", "trips", value)}
              />
              <NumberField
                label="Объём груза"
                value={project.settings.delivery.cargoVolume}
                suffix="м³"
                onChange={(value) =>
                  setSetting("delivery", "cargoVolume", value)
                }
              />
              <NumberField
                label="База рейса"
                value={project.settings.delivery.baseTrip}
                suffix="₽"
                step={100}
                onChange={(value) => setSetting("delivery", "baseTrip", value)}
              />
              <NumberField
                label="Цена километра"
                value={project.settings.delivery.perKm}
                suffix="₽"
                step={1}
                onChange={(value) => setSetting("delivery", "perKm", value)}
              />
              <NumberField
                label="Разгрузка"
                value={project.settings.delivery.unloadingPerM3}
                suffix="₽/м³"
                step={10}
                onChange={(value) =>
                  setSetting("delivery", "unloadingPerM3", value)
                }
              />
            </div>
          </Panel>
          <Panel title="Ведомость доставки">
            <SectionResult calculation={calculation} sectionKey="delivery" />
          </Panel>
        </>
      ) : null}
    </div>
  );
}
