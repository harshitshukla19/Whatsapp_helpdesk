/* =========================================================
   WhatsApp Chat / Ticketing Platform - MSSQL Schema
   Run this whole file against your target database.
   ========================================================= */

IF OBJECT_ID('dbo.TicketMessages', 'U') IS NOT NULL DROP TABLE dbo.TicketMessages;
IF OBJECT_ID('dbo.Tickets', 'U') IS NOT NULL DROP TABLE dbo.Tickets;
IF OBJECT_ID('dbo.TicketSequence', 'U') IS NOT NULL DROP TABLE dbo.TicketSequence;
GO

CREATE TABLE dbo.Tickets (
    TicketID       VARCHAR(20)   NOT NULL PRIMARY KEY,   -- e.g. TKT-000001
    CustomerName   NVARCHAR(100) NULL,
    MobileNumber   VARCHAR(15)   NOT NULL,
    Subject        NVARCHAR(255) NULL,
    Status         VARCHAR(20)   NOT NULL DEFAULT 'Open', -- Open, InProgress, Resolved, Closed
    AssignedTo     NVARCHAR(100) NULL,
    CreatedAt      DATETIME      NOT NULL DEFAULT GETDATE(),
    UpdatedAt      DATETIME      NOT NULL DEFAULT GETDATE()
);
GO

CREATE TABLE dbo.TicketMessages (
    MessageID    INT IDENTITY(1,1) PRIMARY KEY,
    TicketID     VARCHAR(20)   NOT NULL FOREIGN KEY REFERENCES dbo.Tickets(TicketID),
    SenderType   VARCHAR(10)   NOT NULL,                 -- 'Customer' or 'Agent'
    SenderName   NVARCHAR(100) NULL,
    MessageText  NVARCHAR(MAX) NOT NULL,
    CreatedAt    DATETIME      NOT NULL DEFAULT GETDATE()
);
GO

CREATE TABLE dbo.TicketSequence (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    LastNumber INT NOT NULL DEFAULT 0
);
GO
INSERT INTO dbo.TicketSequence (LastNumber) VALUES (0);
GO

CREATE INDEX IX_TicketMessages_TicketID ON dbo.TicketMessages(TicketID);
CREATE INDEX IX_Tickets_MobileNumber ON dbo.Tickets(MobileNumber);
CREATE INDEX IX_Tickets_Status ON dbo.Tickets(Status);
GO

/* =========================================================
   Stored Procedures
   ========================================================= */

-- Get next ticket number atomically, format TKT-000001
IF OBJECT_ID('dbo.usp_GetNextTicketNumber', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_GetNextTicketNumber;
GO
CREATE PROCEDURE dbo.usp_GetNextTicketNumber
    @NewTicketID VARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NextNum INT;

    UPDATE dbo.TicketSequence
    SET LastNumber = LastNumber + 1,
        @NextNum = LastNumber + 1;

    SET @NewTicketID = 'TKT-' + RIGHT('000000' + CAST(@NextNum AS VARCHAR(6)), 6);
END
GO

-- Create a new ticket + first customer message
IF OBJECT_ID('dbo.usp_CreateTicket', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_CreateTicket;
GO
CREATE PROCEDURE dbo.usp_CreateTicket
    @TicketID     VARCHAR(20),
    @CustomerName NVARCHAR(100) = NULL,
    @MobileNumber VARCHAR(15),
    @Subject      NVARCHAR(255) = NULL,
    @MessageText  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.Tickets (TicketID, CustomerName, MobileNumber, Subject, Status)
    VALUES (@TicketID, @CustomerName, @MobileNumber, @Subject, 'Open');

    INSERT INTO dbo.TicketMessages (TicketID, SenderType, SenderName, MessageText)
    VALUES (@TicketID, 'Customer', @CustomerName, @MessageText);

    SELECT * FROM dbo.Tickets WHERE TicketID = @TicketID;
END
GO

-- Add a message (customer follow-up OR agent reply)
IF OBJECT_ID('dbo.usp_AddMessage', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_AddMessage;
GO
CREATE PROCEDURE dbo.usp_AddMessage
    @TicketID    VARCHAR(20),
    @SenderType  VARCHAR(10),
    @SenderName  NVARCHAR(100) = NULL,
    @MessageText NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Tickets WHERE TicketID = @TicketID)
    BEGIN
        RAISERROR('Ticket not found', 16, 1);
        RETURN;
    END

    INSERT INTO dbo.TicketMessages (TicketID, SenderType, SenderName, MessageText)
    VALUES (@TicketID, @SenderType, @SenderName, @MessageText);

    UPDATE dbo.Tickets SET UpdatedAt = GETDATE() WHERE TicketID = @TicketID;

    SELECT * FROM dbo.TicketMessages WHERE TicketID = @TicketID ORDER BY CreatedAt ASC;
END
GO

-- Get a single ticket by ID
IF OBJECT_ID('dbo.usp_GetTicketById', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_GetTicketById;
GO
CREATE PROCEDURE dbo.usp_GetTicketById
    @TicketID VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Tickets WHERE TicketID = @TicketID;
END
GO

-- Get all messages for a ticket
IF OBJECT_ID('dbo.usp_GetMessagesByTicket', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_GetMessagesByTicket;
GO
CREATE PROCEDURE dbo.usp_GetMessagesByTicket
    @TicketID VARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.TicketMessages WHERE TicketID = @TicketID ORDER BY CreatedAt ASC;
END
GO

-- Get all tickets (internal team dashboard), optional status filter
IF OBJECT_ID('dbo.usp_GetAllTickets', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_GetAllTickets;
GO
CREATE PROCEDURE dbo.usp_GetAllTickets
    @Status VARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.Tickets
    WHERE (@Status IS NULL OR Status = @Status)
    ORDER BY CreatedAt DESC;
END
GO

-- Update ticket status / assignment
IF OBJECT_ID('dbo.usp_UpdateTicketStatus', 'P') IS NOT NULL DROP PROCEDURE dbo.usp_UpdateTicketStatus;
GO
CREATE PROCEDURE dbo.usp_UpdateTicketStatus
    @TicketID   VARCHAR(20),
    @Status     VARCHAR(20),
    @AssignedTo NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Tickets
    SET Status = @Status,
        AssignedTo = COALESCE(@AssignedTo, AssignedTo),
        UpdatedAt = GETDATE()
    WHERE TicketID = @TicketID;

    SELECT * FROM dbo.Tickets WHERE TicketID = @TicketID;
END
GO