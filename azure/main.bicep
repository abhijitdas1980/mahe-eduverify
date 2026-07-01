@description('Azure region, e.g. centralindia')
param location string = resourceGroup().location

@description('Environment suffix: prod or staging')
@allowed(['prod', 'staging'])
param environmentName string = 'prod'

@description('Base name for resources (lowercase, no spaces)')
param appName string = 'eduverify'

@description('PostgreSQL admin login')
param postgresAdminLogin string = 'eduverifyadmin'

@secure()
param postgresAdminPassword string

@secure()
param jwtSecret string

@secure()
param seedAdminPassword string

@description('Public site URL for CORS, e.g. https://eduverify.yourcollege.edu')
param corsOrigin string

@description('App Service SKU — P1v3 recommended for 5k–10k students')
param appServiceSku string = 'P1v3'

@description('PostgreSQL SKU tier for metadata (5k–10k students)')
param postgresSkuName string = 'Standard_D2s_v3'

@description('PostgreSQL storage in GB')
param postgresStorageGb int = 64

var unique = '${appName}${environmentName}'
var storageAccountName = toLower(replace('st${unique}', '-', ''))
var keyVaultName = 'kv-${take(unique, 20)}'
var postgresServerName = 'psql-${take(unique, 40)}'
var appInsightsName = 'appi-${unique}'
var logAnalyticsName = 'log-${unique}'
var appPlanName = 'plan-${unique}'
var webAppName = 'app-${unique}'
var containerName = 'eduverify-documents'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_ZRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 14
    }
  }
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: postgresSkuName
    tier: 'GeneralPurpose'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: postgresStorageGb
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 14
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource postgresFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: 'eduverify'
}

resource appPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appPlanName
  location: location
  sku: {
    name: appServiceSku
    tier: startsWith(appServiceSku, 'P') ? 'PremiumV3' : 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '8080' }
        { name: 'AUTO_SETUP', value: 'true' }
        { name: 'STORAGE_PROVIDER', value: 'azure' }
        { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'AZURE_STORAGE_CONTAINER', value: containerName }
        { name: 'AZURE_STORAGE_SAS_EXPIRY_MINUTES', value: '60' }
        { name: 'PG_POOL_MAX', value: '25' }
        { name: 'CORS_ORIGIN', value: corsOrigin }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'JWT_EXPIRES_IN', value: '12h' }
        { name: 'SEED_ADMIN_ID', value: 'ADM-001' }
        { name: 'SEED_ADMIN_NAME', value: 'Verification Cell Admin' }
        { name: 'SEED_ADMIN_PASSWORD', value: seedAdminPassword }
        {
          name: 'DATABASE_URL'
          value: 'postgresql://${postgresAdminLogin}:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/eduverify?sslmode=require'
        }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webApp.id, 'blob-contributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output storageAccountName string = storage.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output appInsightsConnectionString string = appInsights.properties.ConnectionString
