import { ImportAmountFormatControl, ImportDateFormatControl, ImportSettingRow } from '@/pages/imports/components'
import type { OfxReadingChoices } from '@/pages/imports/ofx/hooks/useOfxReadingChoices'

/**
 * The settings for how the staged files write their dates and amounts, one row each with a hairline
 * between, showing the reading detected until the user picks another
 *
 * @param disabled - Shows the readings the files were imported with without letting them change, for
 *   the files of a finished import
 */
export function OfxReadingChoicesRows({ choices, disabled }: { choices: OfxReadingChoices; disabled: boolean }) {
  return (
    <div className="px-1">
      <ImportSettingRow label="Date format" isLabelDecorative>
        <div className="w-48 max-w-[60%]">
          <ImportDateFormatControl
            format={choices.dateFormat}
            automatic={choices.isDateAutomatic}
            scan={choices.scan.date}
            hasError={choices.isDateRequired}
            placeholder="Choose one"
            disabled={disabled}
            onChange={choices.onDateFormatChange}
          />
        </div>
      </ImportSettingRow>
      <ImportSettingRow label="Amount format" isLabelDecorative hasDivider>
        <div className="w-48 max-w-[60%]">
          <ImportAmountFormatControl
            format={choices.amountFormat}
            automatic={choices.isAmountAutomatic}
            scan={choices.scan.amount}
            hasError={choices.isAmountRequired}
            placeholder="Choose one"
            disabled={disabled}
            onChange={choices.onAmountFormatChange}
          />
        </div>
      </ImportSettingRow>
    </div>
  )
}
