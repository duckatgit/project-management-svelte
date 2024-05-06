import { expect, type Locator, type Page } from '@playwright/test'
import { NewCompany } from './types'
import { CommonRecruitingPage } from './common-recruiting-page'

export class CompanyDetailsPage extends CommonRecruitingPage {
  readonly page: Page

  constructor (page: Page) {
    super(page)
    this.page = page
  }

  readonly inputName = (): Locator => this.page.locator('div.antiEditBox input')
  readonly buttonCompanyDetails = (): Locator => this.page.locator('div.flex-row-center > span', { hasText: 'Company' })
  readonly buttonLocation = (): Locator =>
    this.page.locator('//span[text()="Location"]/following-sibling::div[1]/button/span')

  async checkCompany (data: NewCompany): Promise<void> {
    await expect(this.inputName()).toHaveValue(data.name)
    if (data.socials != null) {
      for (const social of data.socials) {
        await this.checkSocialLinks(social.type, social.value)
      }
    }
    if (data.location != null) {
      await expect(this.buttonLocation()).toHaveText(data.location)
    }
  }

  async editCompany (data: NewCompany): Promise<void> {
    await this.inputName().fill(data.name)
    if (data.socials != null && data.socials.length !== 0) {
      for (const social of data.socials) {
        await this.addSocialLink(social)
      }
    }

    if (data.location != null) {
      await this.buttonCompanyDetails().click()
      await this.buttonLocation().click()
      await this.fillToSelectPopup(this.page, data.location)
    }
  }
}
