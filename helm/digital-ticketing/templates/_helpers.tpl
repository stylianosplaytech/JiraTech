{{- define "digital-ticketing.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "digital-ticketing.fullname" -}}
{{- default (include "digital-ticketing.name" .) .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "digital-ticketing.namespace" -}}
{{- $namespace := .Values.namespace | toString | trim -}}
{{- if $namespace -}}
{{- $namespace -}}
{{- else -}}
{{- printf "dgt-digital-ticketing-%s" (.Values.environmentNumber | toString) -}}
{{- end -}}
{{- end -}}

{{- define "digital-ticketing.hostname" -}}
{{- printf "dgt-digital-ticketing-%s.%s" (.Values.environmentNumber | toString) (.Values.ingressDomain | toString) -}}
{{- end -}}

{{- define "digital-ticketing.labels" -}}
app.kubernetes.io/name: {{ include "digital-ticketing.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: digital-ticketing
{{- end -}}

{{- define "digital-ticketing.selectorLabels" -}}
app.kubernetes.io/name: {{ include "digital-ticketing.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "digital-ticketing.bartenderLabels" -}}
selector: {{ default "devops" .Values.bartenderSelector | quote }}
repo: {{ default "digital-ticketing" .Values.bartenderRepo | quote }}
{{- with .Values.prId }}
prId: {{ . | toString | quote }}
{{- end }}
{{- with .Values.branch }}
{{- $safe := regexReplaceAll "[^A-Za-z0-9._-]" (toString .) "-" }}
{{- $label := regexReplaceAll "[^A-Za-z0-9]+$" (trunc 63 $safe) "" }}
{{- with $label }}
branch: {{ . | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "digital-ticketing.bartenderAnnotations" -}}
{{- with .Values.prId }}
prId: {{ . | toString | quote }}
{{- end }}
{{- with .Values.xUser }}
X_USER: {{ . | toString | quote }}
{{- end }}
{{- with .Values.xUsername }}
X_USERNAME: {{ . | toString | quote }}
{{- end }}
{{- with .Values.branch }}
CF_BRANCH: {{ . | toString | quote }}
{{- end }}
{{- end -}}
