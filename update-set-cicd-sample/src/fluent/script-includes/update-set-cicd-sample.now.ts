import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['update-set-cicd-sample-script-include'],
    table: 'sys_script_include',
    data: {
        name: 'UpdateSetCicdSample',
        api_name: 'x_snc_uds_cisamp.UpdateSetCicdSample',
        description: 'Sample script include used to verify the update set CI/CD flow.',
        access: 'package_private',
        active: true,
        client_callable: false,
        script: Now.include('../../server/script-includes/UpdateSetCicdSample.js'),
    },
})
