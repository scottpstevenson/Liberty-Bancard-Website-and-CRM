import {applyCertificationProviderDenyBoundary,installCertificationLocalAiConstructorEnvironment} from './certification-provider-deny';
applyCertificationProviderDenyBoundary({fatal:true});installCertificationLocalAiConstructorEnvironment();
await import('../server/index');
