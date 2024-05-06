import { expect, Page, Locator } from '@playwright/test'

export class UserProfilePage {
  private readonly page: Page

  // Locators using lambda functions
  profileButton = (): Locator => this.page.locator('#profile-button')
  locationInput = (): Locator => this.page.locator('[placeholder="Location"]')
  phoneContactInput = (): Locator => this.page.locator('.search')
  phonePopupButton = (): Locator => this.page.locator('.popup button:has-text("Phone")')
  applyChangesButton = (): Locator => this.page.locator('.editor-container button:nth-child(3)')
  addSocialLinksButton = (): Locator => this.page.locator('[id="presentation:string:AddSocialLinks"]')
  selectProfile = (name: string): Locator => this.page.locator(`text=${name}`)

  constructor (page: Page) {
    this.page = page
  }

  async gotoProfile (workspaceUrl: string): Promise<void> {
    const response = await this.page.goto(workspaceUrl)
    if (response === null || response === undefined) {
      throw new Error(`Failed to navigate to ${workspaceUrl}`)
    }
    await response.finished()
  }

  async openProfileMenu (): Promise<void> {
    await this.profileButton().click()
  }

  async selectProfileByName (name: string): Promise<void> {
    await this.selectProfile(name).click()
  }

  async verifyProfilePageUrl (expectedUrl: string): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl)
  }

  async updateLocation (newLocation: string): Promise<void> {
    await this.locationInput().click()
    await this.locationInput().fill(newLocation)
  }

  async addOrEditPhone (): Promise<void> {
    if ((await this.phoneContactInput().count()) === 0) {
      await this.addSocialLinksButton().click()
      await this.phonePopupButton().click()
    } else {
      await this.phoneContactInput().click()
    }
    await this.phoneContactInput().fill('+1 555 333 7777')
  }

  async applyChanges (): Promise<void> {
    await this.applyChangesButton().click()
  }
}
