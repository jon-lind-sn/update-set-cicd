var UpdateSetCicdSample = Class.create()
UpdateSetCicdSample.prototype = {
    initialize: function () {},

    // Returns a fixed string so a deploy can be verified from a background script.
    hello: function () {
        return 'update-set-cicd-sample script include'
    },

    type: 'UpdateSetCicdSample',
}
