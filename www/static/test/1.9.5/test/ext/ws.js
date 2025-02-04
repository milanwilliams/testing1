describe("web-sockets extension", function () {
    beforeEach(function () {
        this.server = makeServer();
        this.socketServer = new Mock.Server('ws://localhost:8080');
        this.messages = [];
        this.clock = sinon.useFakeTimers();

        this.socketServer.on('connection', function (socket) {
            socket.on('message', function (event) {
                this.messages.push(event)
            }.bind(this))
        }.bind(this))

        /* Mock socket library is cool, but it uses setTimeout to emulate asynchronous nature of the network.
        * To avoid unexpected behavior, make sure to call this method whenever socket would have a network communication,
        * e.g., when connecting, disconnecting, sending messages. */
        this.tickMock = function () {
            this.clock.tick(5);
        }

        clearWorkArea();
    });
    afterEach(function () {
        clearWorkArea();
        this.socketServer.close();
        this.socketServer.stop();
        this.clock.restore();
    });

    it('can establish connection with the server', function () {
        this.socketServer.clients().length.should.equal(0);
        make('<div hx-ext="ws" ws-connect="ws://localhost:8080">');
        this.socketServer.clients().length.should.equal(1);

        this.tickMock();
    })

    it('is closed after removal by swap', function () {
        this.server.respondWith("GET", "/test", "Clicked!");

        var div = make('<div hx-get="/test" hx-swap="outerHTML" hx-ext="ws" ws-connect="ws://localhost:8080">');
        this.tickMock();

        this.socketServer.clients().length.should.equal(1);

        div.click();
        this.server.respond();

        this.tickMock();

        this.socketServer.clients().length.should.equal(0);
    })

    it('is closed after removal by js when message is received', function () {
        this.server.respondWith("GET", "/test", "Clicked!");

        var div = make('<div hx-get="/test" hx-swap="outerHTML" hx-ext="ws" ws-connect="ws://localhost:8080">');
        this.tickMock();

        this.socketServer.clients().length.should.equal(1);
        div.parentElement.removeChild(div);

        this.socketServer.emit('message', 'foo');
        this.tickMock();

        this.socketServer.clients().length.should.equal(0);
    })

    it('sends data to the server', function () {
        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
    })

    it('sends data to the server with specific trigger', function () {
        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div hx-trigger="click" ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
    })

    it('sends expected headers to the server', function () {
        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><button hx-trigger="click" hx-target="#target" ws-send id="d1" name="d1-name">div1</button><output id="target"></output></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        var message = JSON.parse(this.messages[0]);
        var headers = message.HEADERS;

        console.log(headers);

        headers['HX-Request'].should.be.equal('true');
        headers['HX-Current-URL'].should.be.equal(document.location.href)
        headers['HX-Trigger'].should.be.equal('d1');
        headers['HX-Trigger-Name'].should.be.equal('d1-name');
        headers['HX-Target'].should.be.equal('target');
    })

    it('handles message from the server', function () {
        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div id="d1">div1</div><div id="d2">div2</div></div>');
        this.tickMock();

        this.socketServer.emit('message', "<div id=\"d1\">replaced</div>");

        this.tickMock();
        byId("d1").innerHTML.should.equal("replaced");
        byId("d2").innerHTML.should.equal("div2");
    })

    it('raises lifecycle events (connecting, open, close) in correct order', function () {
        var handledEventTypes = [];
        var handler = function (evt) { handledEventTypes.push(evt.detail.event.type) };

        htmx.on("htmx:wsConnecting", handler);

        var div = make('<div hx-get="/test" hx-swap="outerHTML" hx-ext="ws" ws-connect="ws://localhost:8080">');

        htmx.on(div, "htmx:wsOpen", handler);
        htmx.on(div, "htmx:wsClose", handler);

        this.tickMock();

        div.parentElement.removeChild(div);
        this.socketServer.emit('message', 'foo');

        this.tickMock();

        handledEventTypes.should.eql(['connecting', 'open', 'close']);

        this.tickMock();

        htmx.off("htmx:wsConnecting", handler);
        htmx.off(div, "htmx:wsOpen", handler);
        htmx.off(div, "htmx:wsClose", handler);
    })

    it('raises htmx:wsConfigSend when sending, allows message modification', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
            evt.detail.parameters.foo = "bar";
        }

        htmx.on("htmx:wsConfigSend", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        myEventCalled.should.be.true;
        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        htmx.off("htmx:wsConfigSend", handle)
    })

    it('passes socketWrapper to htmx:wsConfigSend', function () {
        var socketWrapper = null;

        function handle(evt) {
            evt.preventDefault();
            socketWrapper = evt.detail.socketWrapper;
            socketWrapper.send(JSON.stringify({foo: 'bar'}), evt.detail.elt)
        }

        htmx.on("htmx:wsConfigSend", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        socketWrapper.should.not.be.null;
        socketWrapper.send.should.be.a('function');
        socketWrapper.sendImmediately.should.be.a('function');
        socketWrapper.queue.should.be.an('array');

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')

        htmx.off("htmx:wsConfigSend", handle);
    })

    it('cancels sending when htmx:wsConfigSend is cancelled', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
            evt.preventDefault();
        }

        htmx.on("htmx:wsConfigSend", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.messages.length.should.equal(0);

        myEventCalled.should.be.true;

        htmx.off("htmx:wsConfigSend", handle);
    })

    it('raises htmx:wsBeforeSend when sending', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
        }

        htmx.on("htmx:wsBeforeSend", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        myEventCalled.should.be.true;
        this.messages.length.should.equal(1);
        htmx.off("htmx:wsBeforeSend", handle)
    })

    it('cancels sending when htmx:wsBeforeSend is cancelled', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
            evt.preventDefault();
        }

        htmx.on("htmx:wsBeforeSend", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        myEventCalled.should.be.true;
        this.messages.length.should.equal(0);
        htmx.off("htmx:wsBeforeSend", handle)
    })

    it('raises htmx:wsAfterSend when sending', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
        }

        htmx.on("htmx:wsAfterSend", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div ws-send id="d1">div1</div></div>');
        this.tickMock();

        byId("d1").click();

        this.tickMock();

        myEventCalled.should.be.true;
        this.messages.length.should.equal(1);
        htmx.off("htmx:wsAfterSend", handle)
    })

    it('raises htmx:wsBeforeMessage when receiving message from the server', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
        }

        htmx.on("htmx:wsBeforeMessage", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div id="d1">div1</div><div id="d2">div2</div></div>');
        this.tickMock();

        this.socketServer.emit('message', "<div id=\"d1\">replaced</div>")

        this.tickMock();
        myEventCalled.should.be.true;

        htmx.off("htmx:wsBeforeMessage", handle)
    })

    it('cancels swap when htmx:wsBeforeMessage was cancelled', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
            evt.preventDefault();
        }

        htmx.on("htmx:wsBeforeMessage", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div id="d1">div1</div><div id="d2">div2</div></div>');
        this.tickMock();

        this.socketServer.emit('message', "<div id=\"d1\">replaced</div>")

        this.tickMock();
        myEventCalled.should.be.true;

        byId("d1").innerHTML.should.equal("div1");
        byId("d2").innerHTML.should.equal("div2");

        htmx.off("htmx:wsBeforeMessage", handle)
    })

    it('raises htmx:wsAfterMessage when message was completely processed', function () {
        var myEventCalled = false;

        function handle(evt) {
            myEventCalled = true;
        }

        htmx.on("htmx:wsAfterMessage", handle)

        var div = make('<div hx-ext="ws" ws-connect="ws://localhost:8080"><div id="d1">div1</div><div id="d2">div2</div></div>');
        this.tickMock();

        this.socketServer.emit('message', "<div id=\"d1\">replaced</div>")

        this.tickMock();
        myEventCalled.should.be.true;

        htmx.off("htmx:wsAfterMessage", handle)
    })

    it('sends data to the server with non-htmx form + submit button & value', function () {
        make('<form hx-ext="ws" ws-connect="ws://localhost:8080" ws-send>' +
            '<input type="hidden" name="foo" value="bar">' +
            '<button id="b1" type="submit" name="action" value="A">A</button>' +
            '<button id="b2" type="submit" name="action" value="B">B</button>' +
            '</form>');
        this.tickMock();

        byId("b1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        this.messages[0].should.contains('"action":"A"')

        byId("b2").click();

        this.tickMock();

        this.messages.length.should.equal(2);
        this.messages[1].should.contains('"foo":"bar"')
        this.messages[1].should.contains('"action":"B"')
    })

    it('sends data to the server with non-htmx form + submit input & value', function () {
        make('<form hx-ext="ws" ws-connect="ws://localhost:8080" ws-send>' +
            '<input type="hidden" name="foo" value="bar">' +
            '<input id="b1" type="submit" name="action" value="A">' +
            '<input id="b2" type="submit" name="action" value="B">' +
            '</form>');
        this.tickMock();

        byId("b1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        this.messages[0].should.contains('"action":"A"')

        byId("b2").click();

        this.tickMock();

        this.messages.length.should.equal(2);
        this.messages[1].should.contains('"foo":"bar"')
        this.messages[1].should.contains('"action":"B"')
    })

    it('sends data to the server with child non-htmx form + submit button & value', function () {
        make('<div hx-ext="ws" ws-connect="ws://localhost:8080">' +
            '<form ws-send>' +
            '<input type="hidden" name="foo" value="bar">' +
            '<button id="b1" type="submit" name="action" value="A">A</button>' +
            '<button id="b2" type="submit" name="action" value="B">B</button>' +
            '</form>' +
            '</div>');
        this.tickMock();

        byId("b1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        this.messages[0].should.contains('"action":"A"')

        byId("b2").click();

        this.tickMock();

        this.messages.length.should.equal(2);
        this.messages[1].should.contains('"foo":"bar"')
        this.messages[1].should.contains('"action":"B"')
    })

    it('sends data to the server with child non-htmx form + submit input & value', function () {
        make('<div hx-ext="ws" ws-connect="ws://localhost:8080">' +
            '<form ws-send>' +
            '<input type="hidden" name="foo" value="bar">' +
            '<input id="b1" type="submit" name="action" value="A">' +
            '<input id="b2" type="submit" name="action" value="B">' +
            '</form>' +
            '</div>');
        this.tickMock();

        byId("b1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        this.messages[0].should.contains('"action":"A"')

        byId("b2").click();

        this.tickMock();

        this.messages.length.should.equal(2);
        this.messages[1].should.contains('"foo":"bar"')
        this.messages[1].should.contains('"action":"B"')
    })

    it('sends data to the server with external non-htmx form + submit button & value', function () {
        make('<div hx-ext="ws" ws-connect="ws://localhost:8080">' +
            '<form ws-send id="form">' +
            '<input type="hidden" name="foo" value="bar">' +
            '</form>' +
            '</div>' +
            '<button id="b1" form="form" type="submit" name="action" value="A">A</button>' +
            '<button id="b2" form="form" type="submit" name="action" value="B">B</button>');
        this.tickMock();

        byId("b1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        this.messages[0].should.contains('"action":"A"')

        byId("b2").click();

        this.tickMock();

        this.messages.length.should.equal(2);
        this.messages[1].should.contains('"foo":"bar"')
        this.messages[1].should.contains('"action":"B"')
    })

    it('sends data to the server with external non-htmx form + submit input & value', function () {
        make('<div hx-ext="ws" ws-connect="ws://localhost:8080">' +
            '<form ws-send id="form">' +
            '<input type="hidden" name="foo" value="bar">' +
            '</form>' +
            '</div>' +
            '<input id="b1" form="form" type="submit" name="action" value="A">' +
            '<input id="b2" form="form" type="submit" name="action" value="B">');
        this.tickMock();

        byId("b1").click();

        this.tickMock();

        this.messages.length.should.equal(1);
        this.messages[0].should.contains('"foo":"bar"')
        this.messages[0].should.contains('"action":"A"')

        byId("b2").click();

        this.tickMock();

        this.messages.length.should.equal(2);
        this.messages[1].should.contains('"foo":"bar"')
        this.messages[1].should.contains('"action":"B"')
    })
});
