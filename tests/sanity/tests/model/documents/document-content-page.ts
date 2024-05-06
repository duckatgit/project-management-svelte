import { type Locator, type Page, expect } from '@playwright/test'
import { CommonPage } from '../common-page'

export class DocumentContentPage extends CommonPage {
  readonly page: Page

  constructor (page: Page) {
    super(page)
    this.page = page
  }

  readonly buttonDocumentTitle = (): Locator => this.page.locator('div[class*="main-content"] div.title input')
  readonly inputContent = (): Locator => this.page.locator('div.textInput div.tiptap')
  readonly buttonToolbarLink = (): Locator => this.page.locator('div.text-editor-toolbar button:nth-child(10)')
  readonly inputFormLink = (): Locator => this.page.locator('form[id="text-editor:string:Link"] input')
  readonly buttonFormLinkSave = (): Locator =>
    this.page.locator('form[id="text-editor:string:Link"] button[type="submit"]')

  readonly buttonMoreActions = (): Locator => this.page.locator('div.popupPanel-title button#btn-doc-title-open-more')
  readonly popupPanel = (): Locator => this.page.locator('div.popupPanel-title')
  readonly popupPanelH1 = (): Locator => this.page.locator('div.antiPopup > h1')

  async checkDocumentTitle (title: string): Promise<void> {
    await expect(this.buttonDocumentTitle()).toHaveValue(title)
  }

  async addContentToTheNewLine (newContent: string): Promise<string> {
    await expect(this.inputContent()).toBeVisible()
    await expect(this.inputContent()).toHaveJSProperty('contentEditable', 'true')
    await this.inputContent().pressSequentially(`\n${newContent}`)
    const endContent = await this.inputContent().textContent()
    return endContent ?? ''
  }

  async checkContent (content: string): Promise<void> {
    await expect(this.inputContent()).toHaveText(content)
  }

  async updateDocumentTitle (title: string): Promise<void> {
    await this.buttonDocumentTitle().fill(title)
    await this.buttonDocumentTitle().blur()
  }

  async addRandomLines (count: number, lineLength: number = 36): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.addContentToTheNewLine(Math.random().toString(lineLength).substring(2, lineLength))
      await this.page.waitForTimeout(100)
    }
  }

  async addLinkToText (text: string, link: string): Promise<void> {
    await expect(this.page.locator('p', { hasText: text })).toBeVisible()
    await this.page.locator('p', { hasText: text }).click()
    await this.page.locator('p', { hasText: text }).dblclick()
    await this.buttonToolbarLink().click()

    await this.inputFormLink().fill(link)
    await this.buttonFormLinkSave().click()
  }

  async checkLinkInTheText (text: string, link: string): Promise<void> {
    await expect(this.page.locator('a', { hasText: text })).toHaveAttribute('href', link)
  }

  async executeMoreAction (action: string): Promise<void> {
    await this.buttonMoreActions().click()
    await this.selectFromDropdown(this.page, action)
  }

  async checkIfPopupHasText (text: string): Promise<void> {
    await expect(this.popupPanelH1()).toHaveText(text)
  }
}
