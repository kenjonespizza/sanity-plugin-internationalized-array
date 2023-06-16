import {AddIcon} from '@sanity/icons'
import {Button, Grid, Stack, useToast} from '@sanity/ui'
import equal from 'fast-deep-equal'
import {
  MouseEventHandler,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
} from 'react'
import React from 'react'
import {
  ArrayOfObjectsInputMember,
  ArrayOfObjectsInputProps,
  ArrayOfObjectsItem,
  ArrayOfObjectsItemMember,
  FormInput,
  insert,
  isArraySchemaType,
  isObjectSchemaType,
  set,
  setIfMissing,
  useClient,
  useFormBuilder,
} from 'sanity'
import {suspend} from 'suspend-react'

import {namespace, version} from '../cache'
import type {ArraySchemaWithLanguageOptions, Value} from '../types'
import Feedback from './Feedback'
import {getSelectedValue} from './getSelectedValue'
// TODO: Move this provider to the root component
import {LanguageProvider} from './languageContext'

export type InternationalizedArrayProps = ArrayOfObjectsInputProps<
  Value,
  ArraySchemaWithLanguageOptions
>

export default function InternationalizedArray(
  props: InternationalizedArrayProps
) {
  const {members, value, schemaType, onChange} = props
  const readOnly =
    typeof schemaType.readOnly === 'boolean' ? schemaType.readOnly : false
  const {options} = schemaType
  const toast = useToast()
  const {value: document} = useFormBuilder()
  const deferredDocument = useDeferredValue(document)
  const selectedValue = useMemo(
    () => getSelectedValue(options.select, deferredDocument),
    [options.select, deferredDocument]
  )

  const valueFieldIsPortableTextEditor = useMemo(() => {
    if (isObjectSchemaType(props.schemaType.of[0].type)) {
      const valueField = props.schemaType.of[0].type.fields.find(
        (field) => field.name === 'value'
      )

      return (
        valueField &&
        isArraySchemaType(valueField.type) &&
        valueField.type.of.find(
          (field) => field.type && field.type.name === 'block'
        )
      )
    }

    return false
  }, [props.schemaType.of])

  const {apiVersion} = options
  const client = useClient({apiVersion})
  const languages = Array.isArray(options.languages)
    ? options.languages
    : suspend(
        // eslint-disable-next-line require-await
        async () => {
          if (typeof options.languages === 'function') {
            return options.languages(client, selectedValue)
          }
          return options.languages
        },
        [version, namespace, selectedValue],
        {equal}
      )

  const handleAddLanguage: MouseEventHandler<HTMLButtonElement> = useCallback(
    (event) => {
      if (!languages?.length) {
        return
      }

      const languageId = event.currentTarget.value
      const itemBase = {_type: `${schemaType.name}Value`}

      // Create new items
      const newItems = languageId
        ? // Just one for this language
          [{...itemBase, _key: languageId}]
        : // Or one for every missing language
          languages
            .filter((language) =>
              value?.length ? !value.find((v) => v._key === language.id) : true
            )
            .map((language) => ({...itemBase, _key: language.id}))

      // Insert new items in the correct order
      const languagesInUse = value?.length ? value.map((v) => v) : []

      const insertions = newItems.map((item) => {
        // What's the original index of this language?
        const languageIndex = languages.findIndex((l) => item._key === l.id)

        // What languages are there beyond that index?
        const remainingLanguages = languages.slice(languageIndex + 1)

        // So what is the index in the current value array of the next language in the language array?
        const nextLanguageIndex = languagesInUse.findIndex((l) =>
          // eslint-disable-next-line max-nested-callbacks
          remainingLanguages.find((r) => r.id === l._key)
        )

        // Keep local state up to date incase multiple insertions are being made
        if (nextLanguageIndex < 0) {
          languagesInUse.push(item)
        } else {
          languagesInUse.splice(nextLanguageIndex, 0, item)
        }

        return nextLanguageIndex < 0
          ? // No next language (-1), add to end of array
            insert([item], 'after', [nextLanguageIndex])
          : // Next language found, insert before that
            insert([item], 'before', [nextLanguageIndex])
      })

      onChange([setIfMissing([]), ...insertions])
    },
    [languages, onChange, schemaType.name, value]
  )

  // TODO: This is reordering and re-setting the whole array – it could be surgical
  const handleRestoreOrder = useCallback(() => {
    if (!value?.length || !languages?.length) {
      return
    }

    // Create a new value array in the correct order
    // This would also strip out values that don't have a language as the key
    const updatedValue = value
      .reduce((acc, v) => {
        const newIndex = languages.findIndex((l) => l.id === v?._key)

        if (newIndex > -1) {
          acc[newIndex] = v
        }

        return acc
      }, [] as Value[])
      .filter(Boolean)

    if (value?.length !== updatedValue.length) {
      toast.push({
        title: 'There was an error reordering languages',
        status: 'warning',
      })
    }

    onChange(set(updatedValue))
  }, [toast, languages, onChange, value])

  const allKeysAreLanguages = useMemo(() => {
    if (!value?.length || !languages?.length) {
      return true
    }

    return value?.every((v) => languages.find((l) => l?.id === v?._key))
  }, [value, languages])

  // Check languages are in the correct order
  const languagesInUse = useMemo(
    () =>
      languages && languages.length > 1
        ? languages.filter((l) => value?.find((v) => v._key === l.id))
        : [],
    [languages, value]
  )

  const languagesOutOfOrder = useMemo(() => {
    if (!value?.length || !languagesInUse.length) {
      return []
    }

    return value
      .map((v, vIndex) =>
        vIndex === languagesInUse.findIndex((l) => l.id === v._key) ? null : v
      )
      .filter(Boolean)
  }, [value, languagesInUse])

  const languagesAreValid = useMemo(
    () =>
      !languages?.length ||
      (languages?.length && languages.every((item) => item.id && item.title)),
    [languages]
  )

  useEffect(() => {
    if (languagesOutOfOrder.length > 0 && allKeysAreLanguages) {
      handleRestoreOrder()
    }
  }, [languagesOutOfOrder, allKeysAreLanguages, handleRestoreOrder])

  if (!languagesAreValid) {
    return <Feedback />
  }

  return (
    <LanguageProvider value={{languages}}>
      <Stack space={2}>
        {members?.length > 0 ? (
          <>
            {members.map((member) => {
              if (member.kind === 'item') {
                return (
                  <React.Fragment key={member.key}>
                    {valueFieldIsPortableTextEditor ? (
                      // <>{props.renderDefault(props)}</>
                      <>
                        <ArrayOfObjectsInputMember
                          member={member}
                          renderItem={props.renderItem}
                          renderField={props.renderField}
                          renderInput={props.renderInput}
                          renderPreview={props.renderPreview}
                        />
                      </>
                    ) : (
                      // <div>hey</div>
                      <ArrayOfObjectsItem
                        member={member}
                        renderItem={props.renderItem}
                        renderField={props.renderField}
                        renderInput={props.renderInput}
                        renderPreview={props.renderPreview}
                      />
                    )}
                  </React.Fragment>
                )
              }

              return null
            })}
          </>
        ) : null}

        {/* Show buttons if languages are configured */}
        {/* Hide them if all languages have values */}
        {languages?.length > 0 && languagesInUse.length < languages.length ? (
          <Stack space={2}>
            {/* Hide language-specific buttons if there's only one */}
            {/* No more than 5 columns */}
            {languages.length > 1 ? (
              <Grid columns={Math.min(languages.length, 5)} gap={2}>
                {languages.map((language) => (
                  <Button
                    key={language.id}
                    tone="primary"
                    mode="ghost"
                    fontSize={1}
                    disabled={
                      readOnly ||
                      Boolean(value?.find((item) => item._key === language.id))
                    }
                    text={language.id.toUpperCase()}
                    icon={AddIcon}
                    value={language.id}
                    onClick={handleAddLanguage}
                  />
                ))}
              </Grid>
            ) : null}
            <Button
              tone="primary"
              mode="ghost"
              disabled={
                readOnly || (value && value?.length >= languages?.length)
              }
              icon={AddIcon}
              text={
                // eslint-disable-next-line no-nested-ternary
                value?.length
                  ? `Add missing ${
                      languages.length - value.length === 1
                        ? `language`
                        : `languages`
                    }`
                  : languages.length === 1
                  ? `Add ${languages[0].title} Field`
                  : `Add all languages`
              }
              value=""
              onClick={handleAddLanguage}
            />
          </Stack>
        ) : null}
      </Stack>
    </LanguageProvider>
  )
}
